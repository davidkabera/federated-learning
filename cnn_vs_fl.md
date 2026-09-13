# CNN vs Federated Learning

## CNN is the Model. Federated Learning is the Training Strategy.

Think of it this way:

- **CNN** answers: *what learns?*
- **Federated Learning** answers: *how is the learning organised?*

You could swap the CNN for a simple linear model or a transformer and the federated learning setup would not change at all. The coordination, Redis, the aggregator, the rounds — none of that cares what the model is.

---

## What a CNN Actually Is

A Convolutional Neural Network is just a function that maps an input (a 28×28 pixel image) to an output (probabilities for digits 0–9).

It learns by adjusting its internal parameters (weights) to minimise prediction error. That adjustment process is called backpropagation + gradient descent, and it happens entirely inside one trainer pod on one shard of data.

```
Image pixels → Conv layers → Dense layers → Digit prediction
                   ↑
            these weights are
            what gets averaged
            by FedAvg
```

The CNN does not know it is inside a federated system. It just trains on whatever data the trainer pod hands it.

---

## What Federated Learning Actually Is

Federated learning is the *organisational protocol* around multiple CNNs (or any models) training on separate data without sharing that data.

```
Round t:

  Trainer A               Trainer B
  CNN trains on           CNN trains on
  digits 0–4 only         digits 5–9 only
       │                       │
       │  local weights         │  local weights
       └──────────┬────────────┘
                  ▼
            FedAvg Job
            averages the
            two weight sets
                  │
                  ▼
          new global model
          sent back to both
```

FL is the loop. CNN is what runs inside the loop.

---

## The Key Difference

| | CNN | Federated Learning |
|--|-----|--------------------|
| **What it is** | A model architecture | A training protocol |
| **What it does** | Learns features from images | Coordinates learning across isolated clients |
| **Runs where** | Inside a single trainer pod | Across pods, Redis, and the aggregator |
| **Knows about data** | Yes — processes it directly | No — never sees raw data, only weights |
| **Output** | A prediction | A globally averaged model |

---

## Why CNN Specifically for MNIST

You could use a simpler model (logistic regression, a small MLP). CNN is chosen because:

- Images have **spatial structure** — pixels next to each other are related
- Conv layers exploit that structure efficiently
- It is small enough to train on CPU in minutes
- It is well understood, so accuracy numbers are meaningful

The interesting behaviour in this lab is not the CNN. It is what happens when **Trainer A only knows digits 0–4** and **Trainer B only knows digits 5–9**, and FedAvg has to produce one model that knows all ten. That tension is federated learning. The CNN is just the vessel it happens inside.
