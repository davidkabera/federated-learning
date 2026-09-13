---
title: Part 2 — FL Pipeline
description: Federated learning trainers, Redis coordination, FedAvg aggregation, and how the workload layer binds to the Talos cluster.
---

**Project:** Distributed Federated Learning on Talos Linux  
**Scope:** FL algorithm, pod design, Redis coordination, aggregation, and how this layer binds to the cluster in Part 1  
**Depends on:** Part 1 infrastructure being fully operational

---

## 1. Overview

This document covers the workload layer. The FL pipeline is a set of pods, a cache, a disk, and a job — all scheduled by the Kubernetes cluster described in Part 1. The cluster does not know it is running federated learning. It just runs containers.

```
What Kubernetes sees          What FL sees
─────────────────────         ─────────────────────
Deployment (3 replicas)   →   3 trainer clients
Job (1 completion)        →   FedAvg aggregation
Service (ClusterIP)       →   Redis coordination bus
PVC (ReadWriteMany)       →   shared model checkpoint store
```

The same mapping is the [Architecture](/federated-learning/architecture/) LikeC4 model (submenu after this page): Talos nodes, trainer pods, Redis, the shared PVC, and FedAvg.

---

## 2. What This Pipeline Is (and Is Not)

**Federated learning** (FL) differs from classic distributed training:

| Classic distributed training | Federated learning (this pipeline) |
|-----------------------------|------------------------------------|
| One dataset, split across workers | Each worker has its own private shard |
| Workers share gradients every step | Workers train locally, share model weights per round |
| Data is pooled | Data is never pooled |
| Goal: train faster | Goal: train without centralising data |

On this cluster, FL is a **simulation**. Each trainer pod acts as a fake client with its own MNIST shard. The data is still on the shared PVC. The algorithm is federated; the real-world privacy story is not. That is the right lab: you learn the coordination mechanics, not phone-fleet logistics.

**MNIST** is the dataset: 70,000 grayscale images of handwritten digits (28×28 pixels, 10 classes). It is used here because it is small, well-known, and shows accuracy movement in minutes on CPU.

---

## 3. The Four Components

### 3.1 Init Job

Runs once before anything else. Responsibilities:

- Downloads the MNIST dataset
- Splits it into N shards (one per trainer client)
- Writes shards to the PVC under `/data/mnist/client-{id}/`
- Initialises a random global model, writes it as `round-000.pt`
- Sets Redis key `round:current = 0` and `round:0:state = OPEN`

Without the Init Job completing successfully, trainers have nothing to load.

### 3.2 Trainer Pods (Parallel Workers)

Each pod is one federated client. Kubernetes runs them as a Deployment with `replicas: 2` (one per worker node).

**Each trainer pod, per round:**

```
1. Poll Redis until round:t:state == OPEN
2. Load global model from /data/models/global/round-t.pt
3. Train on /data/mnist/client-{id}/ for E local epochs
4. Write local weights to /data/models/updates/round-t+1/client-{id}.pt
5. INCR round:t:done in Redis
6. Wait for next round
```

The trainer never sees another client's data. It never sees the aggregator's math. It only reads the global model, trains, and writes an update.

**Identity:** Each pod knows its `CLIENT_ID` via a Kubernetes environment variable set in the Deployment spec. This is how it finds its shard and names its update file.

### 3.3 Redis (Coordination Layer)

Redis is not doing any ML math. It is the round traffic cop. Every trainer and the aggregator talk to it via the Kubernetes Service DNS name.

**Key schema:**

| Redis Key | Type | Value | Set by |
|-----------|------|-------|--------|
| `round:current` | string | `7` | Aggregator |
| `round:7:state` | string | `OPEN` / `READY_TO_AGGREGATE` | Aggregator |
| `round:7:done` | integer | `0..N` | Trainer (INCR) |
| `round:7:total` | integer | `N` | Aggregator (on open) |

**A round in Redis terms:**

```
Aggregator:   SET round:7:state OPEN
              PUBLISH fl:events "round:7:open"

Trainer A:    GET round:7:state → OPEN
              [trains]
              SET round:7:client:0 /data/models/updates/round-8/client-0.pt
              INCR round:7:done  → 1

Trainer B:    GET round:7:state → OPEN
              [trains]
              SET round:7:client:1 /data/models/updates/round-8/client-1.pt
              INCR round:7:done  → 2

              (2 == round:7:total)
              SET round:7:state READY_TO_AGGREGATE

Aggregator:   [wakes, sees READY_TO_AGGREGATE, runs FedAvg]
```

Why Redis: atomic `INCR`, `SETNX`, lists, and pub/sub cover everything needed here. Kafka is not needed for MNIST.

### 3.4 FedAvg Aggregation Job

A Kubernetes Job that runs once per round (or loops indefinitely). It wakes when Redis signals `READY_TO_AGGREGATE`.

**The math:**

For each parameter tensor `w` in the model:

```
w_global = Σ (n_i / n) * w_i

where:
  n_i = number of training samples client i trained on
  n   = total samples across all clients
  w_i = weight tensor from client i's update file
```

If all shards are equal size, this is a simple mean. If shards differ in size, clients with more data pull the average harder.

**Aggregator steps per round:**

```
1. Wait for round:t:state == READY_TO_AGGREGATE
2. Load all client update files from /data/models/updates/round-t+1/
3. Average weights (weighted by sample count)
4. Write new global model to /data/models/global/round-t+1.pt
5. Evaluate on held-out MNIST test set
6. Log accuracy for round t+1
7. SET round:current = t+1
8. SET round:t+1:state = OPEN
9. Repeat until MAX_ROUNDS or accuracy target
```

---

## 4. The Model

A small CNN is sufficient. The cluster and coordination are the subjects; MNIST is the load generator.

```
Input: 28×28 grayscale image
  │
  ▼
Conv2D(32 filters, 3×3) + ReLU
  │
  ▼
Conv2D(64 filters, 3×3) + ReLU
  │
  ▼
MaxPool2D + Dropout(0.25)
  │
  ▼
Flatten
  │
  ▼
Dense(128) + ReLU + Dropout(0.5)
  │
  ▼
Dense(10) + Softmax
  │
  ▼
Output: class probabilities for digits 0–9
```

Trainers send model weights to the aggregator via the PVC. They never send raw pixels.

---

## 5. Data Sharding Strategy

Two sharding modes, with different implications:

| Mode | What it means | When FedAvg is interesting |
|------|--------------|--------------------------|
| **IID** (uniform random split) | Each client sees all digit classes equally | Looks like boring data-parallel training |
| **Non-IID** (class-skewed split) | Client 0 sees digits 0–4, Client 1 sees 5–9 | FedAvg must reconcile conflicting local optima — this is where FL matters |

For this lab, use **non-IID sharding**. It makes the convergence behaviour visible and justifies the federated approach.

---

## 6. How Part 2 Binds to Part 1

Every dependency the FL pipeline has on the cluster:

| FL requirement | Cluster feature that provides it | Where defined |
|---------------|----------------------------------|---------------|
| Trainer pods run on separate machines | Worker nodes + scheduler | Part 1 §3.2 |
| Trainers reach Redis by name | Kubernetes Service DNS | Part 1 §5.2 |
| All pods see the same model files | PVC with ReadWriteMany | Part 1 §6 |
| Images available without SSH | Registry + containerd pull | Part 1 §7 |
| Trainer knows its CLIENT_ID | Downward API / env var in Deployment spec | Part 2 §3.2 |
| Aggregator runs once per round | Kubernetes Job | Part 2 §3.4 |
| Dead trainer is restarted | Kubernetes self-healing | Part 1 §10 |

**The binding point is the Kubernetes manifest.** The Deployment spec for trainers references:
- The PVC name from Part 1
- The Redis Service name from Part 1
- The image tag from the registry in Part 1
- The `CLIENT_ID` env var unique to Part 2

---

## 7. One Full Round, End to End

```
┌─────────────────────────────────────────────────────────────┐
│ ROUND t                                                     │
│                                                             │
│  Redis: round:t:state = OPEN                               │
│                  │                                          │
│         ┌────────┴────────┐                                │
│         ▼                 ▼                                │
│   Trainer Pod A     Trainer Pod B                          │
│   (worker-01)       (worker-02)                            │
│         │                 │                                │
│   Load round-t.pt   Load round-t.pt   (from PVC)          │
│   Train on shard-0  Train on shard-1                       │
│   Write client-0.pt Write client-1.pt (to PVC)            │
│   INCR round:t:done INCR round:t:done (Redis)              │
│         │                 │                                │
│         └────────┬────────┘                                │
│                  │ done count == 2                         │
│                  ▼                                          │
│   Redis: round:t:state = READY_TO_AGGREGATE                │
│                  │                                          │
│                  ▼                                          │
│         FedAvg Aggregator Job                              │
│         Loads client-0.pt + client-1.pt (from PVC)        │
│         Averages weights                                    │
│         Writes round-(t+1).pt (to PVC)                    │
│         Evaluates on test set                              │
│         Logs accuracy                                       │
│         Redis: round:current = t+1, state = OPEN          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                   Repeat for MAX_ROUNDS
```

---

## 8. Failure Handling

| Failure | Kubernetes behaviour | FL implication |
|---------|---------------------|----------------|
| Trainer pod dies mid-round | Kubelet restarts it | Redis `done` counter unchanged; pod re-trains the round |
| Aggregator job fails | Job controller retries | Round stays in `READY_TO_AGGREGATE`; retry is safe |
| Redis pod restarts | State lost | Round must be re-opened; add Redis persistence (AOF) for robustness |
| Node goes NotReady | Scheduler evicts pods to other nodes | Only 2 workers; pod may stay Pending if remaining worker is full |

For the lab, Redis state loss is acceptable. For production FL, enable Redis AOF persistence.

---

## 9. Deployment Sequence (FL Pipeline)

Assumes Part 1 cluster is fully up and `kubectl get nodes` shows all three nodes Ready.

```bash
# 1. Build and push images
docker build -t registry.local/fl-init:0.1      ./init/
docker build -t registry.local/fl-trainer:0.1   ./trainer/
docker build -t registry.local/fl-aggregator:0.1 ./aggregator/
docker push registry.local/fl-init:0.1
docker push registry.local/fl-trainer:0.1
docker push registry.local/fl-aggregator:0.1

# 2. Create namespace
kubectl create namespace fl

# 3. Deploy Redis
kubectl apply -f manifests/redis.yaml -n fl

# 4. Apply PVC (references storage class from Part 1)
kubectl apply -f manifests/pvc.yaml -n fl

# 5. Run init job (data sharding + model init)
kubectl apply -f manifests/init-job.yaml -n fl
kubectl wait --for=condition=complete job/fl-init -n fl --timeout=120s

# 6. Deploy trainers
kubectl apply -f manifests/trainer-deployment.yaml -n fl

# 7. Deploy aggregator
kubectl apply -f manifests/aggregator-job.yaml -n fl

# 8. Watch rounds progress
kubectl logs -f deployment/fl-trainer -n fl
kubectl logs -f job/fl-aggregator    -n fl
```

---

## 10. What Success Looks Like

After `MAX_ROUNDS` (e.g. 10):

- Aggregator logs show accuracy increasing each round
- Each trainer log shows it only loaded its own shard
- `kubectl get pods -n fl -o wide` shows trainers on different nodes
- Redis key `round:current` equals `MAX_ROUNDS`
- Final model checkpoint exists at `/data/models/global/round-010.pt` on the PVC

A target accuracy above **95%** on MNIST test set is achievable in 10–20 rounds on CPU with non-IID sharding and a 2-client setup.
