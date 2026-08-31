<h1 align="center">🦾 LeLab Fork</h1>

<p align="center">
  <b>A custom fork of the official graphical interface for <a href="https://github.com/huggingface/lerobot">LeRobot</a>.</b>
</p>

<div align="center">

</div>

## Overview

This repository contains custom changes based on the original <a href="https://github.com/huggingface/leLab">LeLab</a> project. Because the fork may not always track the latest upstream release, review the modifications below before installing it to determine whether they suit your workflow.

## What do we bring to the table

| Area | Custom improvement |
|------|--------------------|
| 🛡️ **Crash-safe recording** | Save an in-progress episode when recording exits with an error, and flush Parquet footers after every completed episode so collected data survives a hard crash. |
| 🔀 **Merge datasets** | Combine multiple local datasets into a new dataset through a background merge with a live progress log. |
| ✂️ **Delete episodes** | Remove unwanted demonstrations by episode index, either non-destructively or in place. |
| 🔁 **Add or re-record demonstrations** | Select episodes to replace, review them first, delete them safely, and immediately record new demonstrations into the dataset. |
| ▶️ **Episode replay** | Preview any recorded episode in a per-camera video modal before deciding whether to keep or replace it. |
| 📷 **Live camera monitoring** | Display optimized MJPEG camera grids while recording and during policy inference without opening each camera twice. |
| ⏸️ **Recording controls** | Pause recording safely between episodes and resume without losing the current session. |
| 🧠 **Training controls** | Pause, resume, stop, monitor, and rename local training jobs from the browser. |
| 🎯 **Model fine-tuning** | Initialize a new training run from a compatible local or imported checkpoint while keeping it separate from interrupted-run recovery. |
| ⚙️ **Diffusion configuration** | Configure Diffusion Policy horizons, encoders, U-Net options, schedulers, timesteps, prediction behavior, and loss masking in the interface. |

The crash-safety changes affect the separate LeRobot core checkout; the other features are implemented in this LeLab fork. See [CHANGES.md](CHANGES.md) for the complete technical description and [GettingStarted.md](GettingStarted.md) for installation instructions.

## Main interface tour

Explore these sections after starting LeLab:

1. **Home and robot setup** — configure a robot and cameras, then open the calibration or teleoperation workflow.
2. **Recording** — create demonstrations while monitoring all configured camera feeds; pause and resume safely between episodes.
3. **Edit Datasets** — merge local datasets or remove unwanted episodes.
4. **Add / Re-record** — inspect episodes, replay their camera videos, replace selected demonstrations, or append new ones.
5. **Training** — configure ACT or Diffusion Policy, fine-tune from a compatible checkpoint, and monitor, pause, resume, stop, or rename local jobs.
6. **Inference** — run a trained policy and monitor its live camera feeds alongside rollout progress.
7. **Upload** — publish a completed dataset to the <a href="https://huggingface.co/">Hugging Face Hub</a>.

## Contribute

PRs welcome. Hot-reload mode for working on the code:

```bash
lelab --dev
```

This starts Vite on port `8080` and Uvicorn with automatic reload on port `8000`.
