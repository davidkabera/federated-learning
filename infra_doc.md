# Part 1 — Infrastructure: Talos Kubernetes Cluster
**Project:** Distributed Federated Learning on Talos Linux  
**Scope:** Cluster provisioning, node roles, networking, storage, and context management  
**Environment:** Oracle VM Box → 3 Talos Linux installs

---

## 1. Overview

This document covers the infrastructure layer only. The cluster is the factory floor. It does not know or care about federated learning — it schedules pods, manages storage, and routes network traffic. The ML pipeline described in Part 2 runs on top of it.

```
Oracle VM Box
│
├── talos-cp-01       (Control Plane)
│     API server · etcd · scheduler · controller-manager
│
├── talos-worker-01   (Worker A)
│     kubelet · containerd · trainer pod A
│
└── talos-worker-02   (Worker B)
      kubelet · containerd · trainer pod B
```

---

## 2. What Talos Linux Is

Talos is an OS built exclusively to run Kubernetes. There is no SSH, no shell, no package manager on the node. The node is a sealed appliance managed entirely through the `talosctl` API.

| Traditional (Ubuntu + kubeadm) | Talos |
|-------------------------------|-------|
| SSH into node, apt-install | No shell, no apt |
| Break the OS, break the cluster | OS is immutable |
| Manual kubelet config | Config applied via `talosctl` API |
| Docker or containerd, your choice | containerd only, pre-installed |

Everything that runs on the node is a container image pulled by kubelet. You cannot `pip install` on a Talos node. This is why training code ships as a container image built elsewhere.

---

## 3. Node Roles

### 3.1 Control Plane (`talos-cp-01`)

Runs the Kubernetes control-plane components as static pods:

- **API Server** — the single entry point for all `kubectl` commands
- **etcd** — distributed key-value store; holds all cluster state
- **Scheduler** — decides which worker node a pod lands on
- **Controller Manager** — watches for desired vs actual state, self-heals

The control plane does not run trainer pods. It only manages the cluster.

### 3.2 Workers (`talos-worker-01`, `talos-worker-02`)

Run `kubelet` and `containerd`. Kubelet receives pod specs from the API server. Containerd pulls images and starts containers.

```
API Server (CP)
      │  pod spec
      ▼
   kubelet  (worker)
      │  CRI call
      ▼
 containerd
      │  OCI run
      ▼
  runc → container (trainer pod)
```

---

## 4. Version Compatibility

Three versions must be pinned and kept in sync:

| Component | Role | Pin Rule |
|-----------|------|----------|
| `talosctl` client | CLI on your machine | Same major.minor as nodes |
| Talos Linux image | OS on each node | Explicit version, e.g. `v1.7.x` |
| Kubernetes version | Scheduled by Talos | Only versions Talos supports for that release |

Talos does not allow arbitrary Kubernetes versions. Each Talos release ships a supported K8s range. Upgrade Kubernetes only through `talosctl upgrade-k8s`, never by changing image tags manually.

**Example pin (machine config):**
```yaml
# In Talos machine config
cluster:
  kubernetesVersion: v1.30.x
```

---

## 5. Networking

### 5.1 CNI

Talos defaults to **Flannel** as the CNI. For this lab it is sufficient. All three nodes must be reachable on the same subnet inside the Oracle VM box.

Required ports between nodes:

| Port | Protocol | Purpose |
|------|----------|---------|
| 6443 | TCP | Kubernetes API server |
| 2379-2380 | TCP | etcd (control plane only) |
| 10250 | TCP | kubelet API |
| 8472 | UDP | Flannel VXLAN overlay |

### 5.2 Service DNS

Kubernetes assigns each Service a DNS name inside the cluster:

```
redis-service.fl-namespace.svc.cluster.local
```

Trainer pods reach Redis by this DNS name, not by IP. This is how Part 2 workloads are decoupled from node IPs.

---

## 6. Storage

This is the hardest part of a real multi-node Talos cluster. A PVC on Worker A is not visible to Worker B without a storage layer that spans nodes.

### 6.1 The Problem

The FL pipeline needs a shared volume where:
- All trainer pods write their model updates
- The aggregator reads all updates
- Multiple pods on different nodes access it simultaneously

This requires `ReadWriteMany` (RWX) access mode.

### 6.2 Storage Options

| Option | Complexity | Suitable for this lab? |
|--------|------------|----------------------|
| **NFS server on CP node** | Low | Yes — good enough for MNIST lab |
| **Longhorn** (CSI) | Medium | Yes — runs on Talos, installs via Helm |
| **Rook-Ceph** | High | Overkill |
| **hostPath** | None | No — pins pods to one node |

**Recommended for this lab: NFS on the control plane node.**

A simple NFS server pod on the CP node exports `/data`. Workers mount it via a PersistentVolume backed by NFS. All nodes can read and write the same directory.

### 6.3 PVC Layout (used by Part 2)

```
/data/
├── mnist/
│   ├── client-0/     ← shard for trainer pod A
│   └── client-1/     ← shard for trainer pod B
├── models/
│   ├── global/
│   │   ├── round-000.pt
│   │   └── round-001.pt
│   └── updates/
│       ├── round-001/
│       │   ├── client-0.pt
│       │   └── client-1.pt
```

Redis stores keys and flags. The PVC stores bytes. Redis is not a blob store.

---

## 7. Container Image Delivery

Talos nodes cannot `docker load` an image from your laptop. Images must be pulled from a registry the nodes can reach.

```
Your machine
  docker build -t registry.local/fl-trainer:0.1 .
  docker push    registry.local/fl-trainer:0.1
        │
        ▼
   Registry (runs on Oracle VM host or CP node)
        │
        ▼
   containerd on worker nodes  ←  kubelet pull request
        │
        ▼
   Pod running
```

**Recommended for this lab:** Run a registry pod on the control plane, exposed as a NodePort. Workers pull over the local subnet. No internet dependency.

---

## 8. Context Management

Each cluster produces two config files. Mixing them up is the most common source of "why are my pods not there" debugging sessions.

| File | Tool | What it controls |
|------|------|-----------------|
| `talosconfig` | `talosctl` | Talks to Talos machine API (node-level ops) |
| `kubeconfig` | `kubectl` | Talks to Kubernetes API (workload ops) |

### 8.1 Commands

```bash
# See all Kubernetes contexts
kubectl config get-contexts

# See all Talos contexts
talosctl config contexts

# Switch Kubernetes context
kubectl config use-context talos-oracle-lab

# Switch Talos context
talosctl config context talos-oracle-lab

# Always verify before applying
kubectl config current-context
talosctl config info
```

### 8.2 Safe Habit

Always name the cluster on creation with `--name`. Never operate against the `default` context. Use `KUBECONFIG` and `TALOSCONFIG` env vars when switching between a lab cluster and any other cluster.

---

## 9. Node Resource Allocation

Based on 8 cores total across the Oracle VM box:

| Node | Role | Cores | RAM (min) | RAM (recommended) |
|------|------|-------|-----------|-------------------|
| talos-cp-01 | Control Plane | 2 | 2 GiB | 4 GiB |
| talos-worker-01 | Worker A | 2 | 1 GiB | 4 GiB |
| talos-worker-02 | Worker B | 2 | 1 GiB | 4 GiB |
| Host overhead | — | 1–2 | — | 2 GiB |
| **Total** | | **8** | **~6 GiB** | **16 GiB** |

16 GiB RAM across the box is the real minimum for a stable lab. Below 8 GiB total, nodes will OOM during training.

---

## 10. What the Infrastructure Does Not Do

The cluster does not know about federated learning. It provides:

- Scheduled execution of pods across nodes
- Service DNS for pod-to-pod communication
- Persistent shared storage via PVC
- Self-healing (dead pods are restarted)
- Resource enforcement (CPU/memory limits on trainer pods)

The FL algorithm, Redis coordination, and model averaging are entirely in Part 2.

---

## 11. Deployment Sequence (Infrastructure Only)

```
1. Install Talos Linux on all three nodes
2. Generate machine configs (talosctl gen config)
3. Apply control-plane config to talos-cp-01
4. Bootstrap etcd (talosctl bootstrap)
5. Apply worker config to talos-worker-01 and talos-worker-02
6. Retrieve kubeconfig (talosctl kubeconfig)
7. Verify nodes are Ready (kubectl get nodes)
8. Install CNI if not auto-applied
9. Deploy NFS server or Longhorn CSI
10. Create PVC and verify ReadWriteMany mount from both workers
11. Deploy local registry on CP node
12. Cluster is ready to receive Part 2 workloads
```
