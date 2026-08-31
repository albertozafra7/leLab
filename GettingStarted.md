# Getting Started

This guide covers the full workflow for the SO-101 dual-arm setup: hardware preparation, dataset recording, model training, evaluation, and the naming conventions used throughout the project.

---

## Table of Contents

1. [Hardware Setup](#1-hardware-setup)
2. [Software Installation](#2-software-installation)
3. [Pre-Recording Camera Setup](#3-pre-recording-camera-setup)
4. [Recording a Dataset](#4-recording-a-dataset)
5. [Managing Datasets](#5-managing-datasets)
6. [Training a Model](#6-training-a-model)
7. [Offline Evaluation](#7-offline-evaluation)
8. [Running Inference](#8-running-inference)
9. [Naming Conventions](#9-naming-conventions)
10. [Quick Reference](#10-quick-reference)

---

## 1. Hardware Setup

### Robot arms

| Device | Role | Port |
|--------|------|------|
| SO-101 follower arm | Executes actions | `/dev/ttyACM1` |
| SO-101 leader arm | Teleoperation input | `/dev/ttyACM0` |

> **Tip:** If the ports differ after a replug, check with `ls /dev/ttyACM*` and update the `--robot.port` / `--teleop.port` flags accordingly.

### Cameras

| Name (config key) | Hardware | V4L2 index | Notes |
|-------------------|----------|-----------|-------|
| `wrist_cam` | OAK-D Lite (bridged) | `9` | Mounted on the wrist of the follower arm; requires `connect_oakd_cam.sh` (see §3) |
| `standing_oakd_cam` | USB webcam | `0` | Fixed third-person view of the workspace |

---

## 2. Software Installation

### Prerequisites

- Python 3.12 or newer
- [`uv`](https://docs.astral.sh/uv/)
- Git
- Node.js 22 only when running `lelab --dev` or building the frontend locally

### LeLab GUI

Install this custom repository in editable mode. This keeps the `lelab` command connected to the checkout, so backend changes take effect after restarting the server.

```bash
git clone https://github.com/albertozafra7/leLab.git
cd leLab
uv tool install --editable .

# Verify
lelab --help
lelab
# Open http://localhost:8000
```

LeLab installs its compatible LeRobot dependency from the version pinned in `pyproject.toml` (currently `v0.6.0`).

For frontend development:

```bash
lelab --dev
# FastAPI: http://localhost:8000
# Vite UI: http://localhost:8080
```

Production mode serves the committed `frontend/dist`. Frontend changes pushed to `main` are rebuilt automatically by `.github/workflows/build_frontend.yml`; for a local production build, run `npm ci && npm run build` inside `frontend/`.

After pulling dependency or entry-point changes, refresh the tool environment while retaining the editable link:

```bash
git pull
uv tool install --force --editable .
```

### Optional LeRobot checkout

A separate LeRobot checkout is only needed for direct CLI development or for the crash-safety patches documented in `CHANGES.md`, Part 1:

```bash
git clone --branch v0.6.0 https://github.com/huggingface/lerobot.git
cd lerobot
uv sync --extra all
export LEROBOT_DIR="$PWD"
```

The Part 1 patches are not stored in this LeLab repository and must be applied separately to that checkout.

---

## 3. Pre-Recording Camera Setup

**Run both steps in this order every time before starting a recording session.**

> **Companion tools:** `ipu6_cam_management.sh`, `connect_oakd_cam.sh`, and `dataset_ops.sh` are optional workstation-specific helpers and are not included in this repository. Set `COMPANION_DIR` to the directory containing them before using the commands below:
>
> ```bash
> export COMPANION_DIR=/path/to/companion-tools
> ```

### Step 1 — Disable the Intel IPU6 camera modules

The IPU6 driver creates multiple spurious `/dev/video*` nodes that clutter camera selection in LeLab and can conflict with OpenCV capture indices.

```bash
"$COMPANION_DIR/ipu6_cam_management.sh" disable
```

Expected output confirms all three `intel_ipu6_*` modules are unloaded. Changes are **temporary** (reverts on reboot).

To re-enable them (e.g. if you need the built-in camera for something else):
```bash
"$COMPANION_DIR/ipu6_cam_management.sh" enable
```

To check current status without changing anything:
```bash
"$COMPANION_DIR/ipu6_cam_management.sh" status
```

---

### Step 2 — Bridge the OAK-D camera to a V4L2 loopback device

The OAK-D Lite is a DepthAI device and is **not** natively visible as a `/dev/video*` node. The bridge streams its RGB output through `v4l2loopback` so OpenCV (and LeLab) can read it at `/dev/video9`.

**First time only — install system dependencies:**
```bash
"$COMPANION_DIR/connect_oakd_cam.sh" setup
```
This installs `v4l2loopback-dkms`, `v4l-utils`, `ffmpeg`, and the Movidius udev rule. Requires sudo.

**Every session — start the bridge:**
```bash
"$COMPANION_DIR/connect_oakd_cam.sh" start
# or equivalently (runs setup + start):
"$COMPANION_DIR/connect_oakd_cam.sh" all
```

The script will:
1. Verify the OAK-D is detected on USB
2. Load `v4l2loopback` on `/dev/video9` with label `OAKD-Virtual`
3. Start a Python/DepthAI pipeline that streams 640×480 @ 30 fps to the loopback device via ffmpeg

**Leave this terminal open.** Press `Ctrl+C` to stop the bridge when done.

To use a different camera index:
```bash
VIDEO_NR=8 "$COMPANION_DIR/connect_oakd_cam.sh" start
# or:
"$COMPANION_DIR/connect_oakd_cam.sh" start --cam_id=8
```

> **Note:** LeLab scans `/dev/video0` through `/dev/video9`. If the bridge device index is ≥ 10 the camera won't appear in the GUI. Always use `VIDEO_NR=0..9`.

---

## 4. Recording a Dataset

### Via LeLab GUI (recommended)

1. Start LeLab: `lelab`
2. Open `http://localhost:8000` in your browser
3. Click **Record** on the landing page
4. Configure:
   - **Robot port:** `/dev/ttyACM1`
   - **Teleop port:** `/dev/ttyACM0`
   - **Dataset name:** follow the naming convention in §9
   - **Cameras:** add `wrist_cam` (index `9`) and `standing_oakd_cam` (index `0`)
   - **Episodes / durations:** as needed
5. Click **Start Recording**

During recording:
- Live camera feeds appear on the right side of the screen
- **Skip episode (→):** ends the current take early and saves it
- **Re-record (↺):** discards the current take and restarts
- **⏸ Pause:** saves the current episode and waits (resume with ▶)
- **■ Stop:** ends the session and finalises the dataset

### Via CLI (`lerobot-record`)

```bash
cd "$LEROBOT_DIR"
uv run lerobot-record \
  --robot.type=so101_follower \
  --robot.port=/dev/ttyACM1 \
  --robot.id=follower \
  --robot.cameras="{wrist_cam: {type: opencv, index_or_path: 9, width: 640, height: 480, fps: 30}, standing_oakd_cam: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}}" \
  --teleop.type=so101_leader \
  --teleop.port=/dev/ttyACM0 \
  --teleop.id=leader \
  --dataset.repo_id="albertozafra7/50_rubber_pickNplace_wristNstatic_cam" \
  --dataset.num_episodes=50 \
  --dataset.single_task="Pick up the rubber duck and place it in the bin" \
  --dataset.fps=30 \
  --dataset.episode_time_s=30 \
  --dataset.reset_time_s=10 \
  --dataset.video_backend=pyav
```

### Via `dataset_ops.sh`

Override the defaults with environment variables for convenience:

```bash
export ROBOT_PORT=/dev/ttyACM1
export ROBOT_ID=follower
export TELEOP_PORT=/dev/ttyACM0
export TELEOP_ID=leader
export CAMERA_CONFIG="{wrist_cam: {type: opencv, index_or_path: 9, width: 640, height: 480, fps: 30}, standing_oakd_cam: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}}"
export NUM_EPISODES=50
export EPISODE_TIME_S=30

"$COMPANION_DIR/dataset_ops.sh" record \
  --repo_id albertozafra7/50_rubber_pickNplace_wristNstatic_cam \
  --root ~/.cache/huggingface/lerobot/albertozafra7/50_rubber_pickNplace_wristNstatic_cam \
  --task "Pick up the rubber duck and place it in the bin"
```

---

## 5. Managing Datasets

The LeLab GUI contains the supported merge, delete, replay, and re-record flows. The examples under **Via CLI** use the optional companion `dataset_ops.sh`; run `"$COMPANION_DIR/dataset_ops.sh" help` for its full usage.

### Via LeLab GUI (recommended)

Use **Edit Datasets** on the landing page to merge datasets or create a cleaned copy with selected episodes removed. Use **Add / Re-record** to inspect, replay, delete, and replace specific episodes.

### Via CLI

#### Resume a recording session

```bash
"$COMPANION_DIR/dataset_ops.sh" resume \
  --repo_id albertozafra7/50_rubber_pickNplace_wristNstatic_cam \
  --root ~/.cache/huggingface/lerobot/albertozafra7/50_rubber_pickNplace_wristNstatic_cam \
  --num_episodes 10   # additional episodes to add
```

#### Merge multiple datasets

```bash
"$COMPANION_DIR/dataset_ops.sh" merge \
  --new_repo_id albertozafra7/125_rubber_combination_pickNplace_wristNstatic_cam \
  --repo_ids "['albertozafra7/50_rubber_pickNplace_wristNstatic_cam', 'albertozafra7/75_rubber_pickNplace_varied_wristNstatic_cam']"
```

#### Delete bad episodes

```bash
"$COMPANION_DIR/dataset_ops.sh" delete \
  --repo_id albertozafra7/50_rubber_pickNplace_wristNstatic_cam \
  --indices "[3, 7, 12]"
```

#### Recover from a crash

```bash
"$COMPANION_DIR/dataset_ops.sh" recover \
  --repo_id albertozafra7/50_rubber_pickNplace_wristNstatic_cam \
  --root ~/.cache/huggingface/lerobot/albertozafra7/50_rubber_pickNplace_wristNstatic_cam
```

This guides you through: inspect → delete last bad episode → resume.

#### Re-record / replay specific episodes via LeLab

1. LeLab landing page → **Add / Re-record**
2. Select your dataset from the dropdown
3. Click ▶ on any episode to **replay** it before deciding
4. Check the boxes for episodes to replace
5. Configure robot and cameras, then click **Delete selected + Start Recording**

---

## 6. Training a Model

### Via LeLab GUI (recommended)

1. LeLab landing page → **Train**
2. Select your dataset, policy type, and hyperparameters. Diffusion policies expose their scheduler, horizon, encoder, and U-Net settings.
3. Optionally enable **Fine-tune a trained model** and select a compatible checkpoint. This starts a new run from policy weights; it does not restore optimizer state.
4. Click **Start Training**
5. Monitor loss/metrics on the training detail page; use the pencil action to rename the run.
6. Use **⏸ Pause** / **▶ Resume** as needed (local jobs only).

### Via CLI (`lerobot-train`)

```bash
cd "$LEROBOT_DIR"
uv run lerobot-train \
  --dataset.repo_id=albertozafra7/125_rubber_combination_pickNplace_wristNstatic_cam \
  --policy.type=act \
  --policy.device=cuda \
  --batch_size=10 \
  --steps=100000 \
  --save_freq=1000 \
  --log_freq=250 \
  --output_dir=~/.cache/huggingface/lerobot/outputs/train/act_albertozafra7_125_rubber_combination_pickNplace_wristNstatic_cam
```

### Resume a frozen or interrupted training

```bash
cd "$LEROBOT_DIR"
uv run lerobot-train \
  --config_path="~/.cache/huggingface/lerobot/outputs/train/<run_dir>/checkpoints/<step>/pretrained_model/train_config.json" \
  --resume=true
```

The `train_config.json` is inside every saved checkpoint directory. Find checkpoints with:
```bash
ls ~/.cache/huggingface/lerobot/outputs/train/<run_dir>/checkpoints/
```

> **`libnvrtc.so.13` error during training:** This occurs when the `torchcodec` video backend tries to load CUDA libraries that are not in `LD_LIBRARY_PATH`. Add `--dataset.video_backend=pyav` to your training command to use the PyAV backend instead.

---

## 7. Offline Evaluation

Offline evaluation measures how accurately a trained policy reproduces the actions recorded in an **existing dataset** — without running the physical robot. It is fast, reproducible, and useful for comparing checkpoints or policy types before committing to a hardware rollout.

> The evaluation scripts referenced in this section are companion LeRobot-workspace utilities; they are not included in this LeLab repository. The examples assume they are available under `$LEROBOT_DIR/examples/evaluation/`.

### 7.1 Evaluate a single policy

```bash
cd "$LEROBOT_DIR"
uv run python examples/evaluation/evaluate_pretrained_policy.py \
  --policy-path ~/.cache/huggingface/lerobot/outputs/train/act_albertozafra7_125_rubber_combination_pickNplace_wristNstatic_cam/checkpoints/100000/pretrained_model \
  --dataset ~/.cache/huggingface/lerobot/albertozafra7/125_rubber_combination_pickNplace_wristNstatic_cam \
  --device cuda
```

Or point directly at a Hugging Face Hub model / dataset:

```bash
cd "$LEROBOT_DIR"
uv run python examples/evaluation/evaluate_pretrained_policy.py \
  --policy-path albertozafra7/act_125_rubber_combination_pickNplace_wristNstatic_cam \
  --dataset albertozafra7/125_rubber_combination_pickNplace_wristNstatic_cam \
  --device cuda
```

#### Key options

| Flag | Default | Description |
|------|---------|-------------|
| `--policy-path` | *(required)* | Local `pretrained_model/` directory **or** HF Hub model repo ID |
| `--dataset` | *(required)* | Local dataset root **or** HF Hub dataset repo ID |
| `--episodes` | all | Space-separated episode indices to evaluate, e.g. `--episodes 0 1 5` |
| `--tolerance` | `0.05` | Max absolute error (in original action units) counted as correct |
| `--batch-size` | `8` | Frames per inference batch |
| `--max-samples` | `0` (all) | Cap total frames evaluated (useful for quick sanity checks) |
| `--video-backend` | `pyav` | Use `pyav` (default, no extra libs) or `torchcodec` (requires CUDA runtime) |
| `--output-dir` | auto-generated | Where to save results; auto-named from policy + dataset hashes |

#### Outputs

All results are written to the output directory (default: `outputs/offline_policy_eval/<auto_name>/`):

| File | Contents |
|------|----------|
| `metrics.json` | Overall summary: `native_loss`, `mae`, `rmse`, `element_accuracy`, `action_accuracy`, per-dimension breakdowns, run metadata |
| `batch_metrics.csv` | Per-batch metrics for every forward pass |
| `metrics.png` | Four-panel plot: loss curve, MAE/RMSE curve, threshold accuracy curve, per-dimension error bars |

**Printed summary example:**
```json
{
  "native_loss": 0.0312,
  "mae": 0.0184,
  "rmse": 0.0271,
  "element_accuracy": 0.9421,
  "action_accuracy": 0.7803,
  "tolerance": 0.05,
  "evaluated_action_vectors": 45000,
  "evaluated_action_elements": 270000
}
```

- **`element_accuracy`**: fraction of individual action-dimension predictions within tolerance.
- **`action_accuracy`**: fraction of complete action vectors where **all** dimensions are within tolerance (stricter).

---

### 7.2 Compare two policies

After running `evaluate_pretrained_policy.py` for two checkpoints or policy types, compare them side by side:

```bash
cd "$LEROBOT_DIR"
uv run python examples/evaluation/compare_policy_evaluations.py \
  --evaluation-a outputs/offline_policy_eval/act_125_rubber_... \
  --evaluation-b outputs/offline_policy_eval/diffusion_125_rubber_... \
  --label-a "ACT" \
  --label-b "Diffusion Policy" \
  --output-dir outputs/offline_policy_eval/act_vs_diffusion
```

Optionally label action dimensions for clearer plots:

```bash
  --action-names shoulder_pan shoulder_lift elbow_flex wrist_flex wrist_roll gripper
```

#### Key options

| Flag | Default | Description |
|------|---------|-------------|
| `--evaluation-a/b` | *(required)* | Paths to the two `evaluate_pretrained_policy.py` output directories |
| `--label-a/b` | policy type from `metrics.json` | Display names in plots and JSON |
| `--action-names` | dimension indices | Optional labels for each action dimension in bar charts |
| `--smoothing-window` | `20` | Rolling-mean window for batch curves (set `1` to disable) |
| `--output-dir` | auto-generated | Output directory for comparison artefacts |

#### Outputs

| File | Contents |
|------|----------|
| `comparison.json` | Side-by-side metrics + `differences_b_minus_a` for each metric |
| `summary_comparison.png` | Bar charts: overall MAE/RMSE, threshold accuracy, per-dimension MAE/RMSE |
| `batch_comparison.png` | Per-batch MAE, RMSE, element accuracy, whole-action accuracy (with rolling mean) |
| `native_loss_context.png` | Individual native-loss curves (note: not numerically comparable across policy types) |

> **Note:** `native_loss` values are policy-specific and **cannot** be compared between ACT and Diffusion — only the unnormalized metrics (MAE, RMSE, accuracy) are directly comparable.

---

## 8. Running Inference

LeLab inference uses `lerobot-rollout` under the hood (joint-space, no IK). This is the quickest way to test a checkpoint.

1. **Start LeLab:** `lelab`
2. Landing page → **Jobs** → select your training run
3. In the **Run inference** bar at the bottom, select a checkpoint step from the dropdown
4. Click **Run inference**
5. Configure:
   - **Follower port:** `/dev/ttyACM1`
   - **Task description:** the task string used during recording
   - **Duration:** seconds to run the rollout
   - **Cameras:** `wrist_cam` (index 9) and `standing_oakd_cam` (index 0)
6. Click **Start**

During inference:
- Live camera feeds appear once the rollout begins publishing its first observations
- A timer shows setup elapsed time and rollout elapsed time separately
- Click **■ Stop** to abort

### Via CLI (`lerobot-rollout`)

```bash
cd "$LEROBOT_DIR"
uv run lerobot-rollout \
  --policy.path=~/.cache/huggingface/lerobot/outputs/train/<run_dir>/checkpoints/<step>/pretrained_model \
  --policy.device=cuda \
  --robot.type=so101_follower \
  --robot.port=/dev/ttyACM1 \
  --robot.id=follower \
  --robot.cameras="{wrist_cam: {type: opencv, index_or_path: 9, width: 640, height: 480, fps: 30}, standing_oakd_cam: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}}" \
  --task="Pick up the rubber duck and place it in the bin" \
  --duration=60
```

### Via CLI (custom script)

The optional companion script at `$LEROBOT_DIR/examples/so100_to_so100_EE/evaluate.py` runs inference using **end-effector (EE) space** — the policy outputs are converted from EE coordinates to joint angles via inverse kinematics before sending to the robot. This script is not included in the LeLab repository.

#### Configure the script

Edit the constants at the top of `evaluate.py`:

```python
NUM_EPISODES = 5
FPS = 30
EPISODE_TIME_SEC = 60
TASK_DESCRIPTION = "Pick up the rubber duck and place it in the bin"
HF_MODEL_ID = "albertozafra7/act_125_rubber_combination_pickNplace"
HF_DATASET_ID = "albertozafra7/eval_125_rubber_combination_pickNplace"
```

Also update the robot configuration block:

```python
camera_config = {
    "wrist_cam": OpenCVCameraConfig(index_or_path=9, width=640, height=480, fps=FPS),
    "standing_oakd_cam": OpenCVCameraConfig(index_or_path=0, width=640, height=480, fps=FPS),
}
robot_config = SO100FollowerConfig(
    port="/dev/ttyACM1",
    id="follower",
    cameras=camera_config,
    use_degrees=True,
)
```

#### Run the inference

```bash
cd "$LEROBOT_DIR"
uv run python examples/so100_to_so100_EE/evaluate.py
```

The script:
- Connects the robot and cameras
- Runs `NUM_EPISODES` evaluation episodes
- Records observations and actions to a new LeRobot dataset (`HF_DATASET_ID`)
- Pushes the evaluation dataset to HuggingFace Hub on exit

#### Keyboard controls during evaluation

| Key | Action |
|-----|--------|
| `→` | Skip to next episode (saves current) |
| `←` | Re-record current episode (discards current) |
| `Esc` | Stop evaluation entirely |

---

## 9. Naming Conventions

Consistent naming makes it easy to trace which model was trained on which data.

### Datasets

```
{hf_username}/{N}_{object}_{task}_{camera_config}[_{suffix}]
```

| Component | Description | Example |
|-----------|-------------|---------|
| `{N}` | Total number of episodes | `125` |
| `{object}` | Main object being manipulated | `rubber`, `apple` |
| `{task}` | Task description (camelCase, `N` for and) | `pickNplace`, `harvest` |
| `{camera_config}` | Active cameras (`N` for and) | `wristNstatic_cam` |
| `{suffix}` | Optional: data breakdown or date stamp | `75samepos_40diffpos_30diffposNnumb` |

**Examples:**

```
albertozafra7/125_rubber_combination_pickNplace_wristNstatic_cam
albertozafra7/75_apple_harvest_samepos_wristNstatic_cam
albertozafra7/145_apple_harvest_75samepos_40diffpos_30diffposNnumb_wristNstatic_cam
```

**Camera config tokens:**

| Token | Meaning |
|-------|---------|
| `wrist_cam` | OAK-D on robot wrist (`/dev/video9`) |
| `static_cam` | Fixed third-person USB webcam (`/dev/video0`) |
| `wristNstatic_cam` | Both cameras |

### Training runs (output directories)

LeLab and the CLI auto-generate the output directory name:

```
{policy_type}_{dataset_id}_{YYYY-MM-DD_HH-MM-SS}
```

**Examples:**

```
act_albertozafra7_125_rubber_combination_pickNplace_wristNstatic_cam_2026-07-26_18-43-16
diffusion_albertozafra7_75_apple_harvest_samepos_wristNstatic_cam_2026-08-08_12-23-30
```

### Evaluation datasets

Follow the same format as training datasets but prefix with `eval_`:

```
albertozafra7/eval_125_rubber_combination_pickNplace_wristNstatic_cam
```

---

## 10. Quick Reference

### Session startup checklist

```bash
# 1. Disable Intel IPU6 cameras
"$COMPANION_DIR/ipu6_cam_management.sh" disable

# 2. Start OAK-D bridge (keep this terminal open)
"$COMPANION_DIR/connect_oakd_cam.sh" start

# 3. Start LeLab GUI (new terminal)
lelab
# → open http://localhost:8000
```

### Check camera indices

```bash
v4l2-ctl --list-devices        # shows all /dev/video* nodes with labels
# OAK-D bridge should appear as "OAKD-Virtual" at /dev/video9
```

### Common dataset paths

```bash
# Local dataset root
~/.cache/huggingface/lerobot/{hf_username}/{dataset_name}/

# Training outputs
~/.cache/huggingface/lerobot/outputs/train/{run_name}/

# Checkpoints
~/.cache/huggingface/lerobot/outputs/train/{run_name}/checkpoints/{step}/pretrained_model/
```

### Video backend issue (torchcodec / CUDA)

If training crashes with `libnvrtc.so.13: cannot open shared object file`, switch the video decoder:

```bash
cd "$LEROBOT_DIR"
uv run lerobot-train ... --dataset.video_backend=pyav
```

Or add to `LD_LIBRARY_PATH`:

```bash
export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
```
