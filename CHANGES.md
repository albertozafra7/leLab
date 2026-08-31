# Changes: LeRobot Crash Safety + LeLab GUI Enhancements

This document summarises **all changes** made to the LeRobot core library and the LeLab GUI from the original upstream versions.

> **Repository scope:** This repository contains the LeLab changes in Parts 2 and 5. The three LeRobot core changes in Part 1 must be applied in a separate LeRobot checkout; installing this repository does not patch LeRobot's source files.

> chat seed: 9ff62455-257b-4026-b9bb-81fa1efb037c

---

## Overview

| # | Area | Problem / Goal | Solution |
|---|------|---------------|----------|
| 1 | LeRobot core | Recording loses all data on error | Save partial episode in `finally` block |
| 2 | LeRobot core | Hard crash (OOM/power-loss) corrupts dataset parquets | Close parquet writer after every episode |
| 3 | LeLab GUI | No way to merge or edit datasets | New Edit Datasets page (Merge + Delete Episodes) |
| 4 | LeLab GUI | Camera feeds not visible during recording | Live MJPEG streaming via `/camera-feed/{cam_key}` |
| 5 | LeLab GUI | No way to add/replace specific demonstrations | New Re-record Episodes page |
| 6 | LeLab GUI | No way to review a recorded demonstration | Episode replay modal (per-camera video) |
| 7 | LeLab GUI | Recording cannot be paused | Pause/Resume recording between episodes |
| 8 | LeLab GUI | Training cannot be paused | Pause/Resume local training jobs (SIGSTOP/SIGCONT) |
| 9 | LeLab GUI | Episode list returned "No episodes found" | Fix HF Dataset API access (integer indexing, not pandas) |
| 10 | LeLab GUI | Existing checkpoints cannot initialize a new training run | Fine-tune from compatible local/imported checkpoints |
| 11 | LeLab GUI | Diffusion policy settings are not configurable | Dedicated Diffusion configuration UI and CLI forwarding |
| 12 | LeLab GUI | Training run names cannot be corrected | Persistent job renaming from the monitoring page |
| 13 | LeLab GUI | Inference preview competes for exclusive cameras | Publish frames from the camera-owning rollout subprocess |
| 14 | LeLab GUI | Recording camera streams can use stale state during start/teardown | Read live module state and snapshot the active robot safely |

---

## Part 1 — LeRobot Core (`src/lerobot/`)

### 1.1 `src/lerobot/scripts/lerobot_record.py` — Save partial episode on error

**Problem:** An exception during recording skipped the current in-progress episode silently.

**Fix:** Check `has_pending_frames()` in the `finally` block and save before finalising.

```diff
@@ -518,6 +518,11 @@ def record(
     if dataset:
+        if dataset.has_pending_frames():
+            logging.warning(
+                "An error occurred during recording. Saving the partially recorded episode before exiting."
+            )
+            dataset.save_episode()
         dataset.finalize()
```

---

### 1.2 `src/lerobot/datasets/dataset_writer.py` — Crash-safe parquet writer

**Problem:** `ParquetWriter` only flushes the file footer on `close()`. A hard crash left files unreadable.

**Fix:** Add `_pending_file_rotation` flag; after every episode call `close_writer()` and set the flag; on the next episode rotate to a new file instead of appending to the closed one.

Key diff (abbreviated):

```diff
+        self._pending_file_rotation: bool = False

-        if latest_size_in_mb + av_size_per_frame * ep_num_frames >= ...:
+        if self._pending_file_rotation:
             chunk_idx, file_idx = update_chunk_file_indices(...)
-            self.close_writer()
             self._current_file_start_frame = global_frame_index
+            self._pending_file_rotation = False
+        else:
+            # existing size-limit logic unchanged

+        # Close after every episode to flush the parquet footer.
+        self.close_writer()
+        self._pending_file_rotation = True
```

---

### 1.3 `src/lerobot/datasets/dataset_metadata.py` — Crash-safe metadata parquet

**Problem:** Same footer-flush problem for the episodes metadata parquet (`meta/episodes/`).

**Fix:** Same pattern — `_pending_file_rotation` flag, `_close_writer()` after every episode.

```diff
+        self._pending_file_rotation: bool = False

+        if self._pending_file_rotation:
+            chunk_idx, file_idx = update_chunk_file_indices(...)
+            self._pending_file_rotation = False
+        else:
+            # existing size-limit logic unchanged

+        self._close_writer()
+        self._pending_file_rotation = True
```

---

## Part 2 — LeLab GUI

Install this fork directly from its checkout so the `lelab` command uses these Python sources:

```bash
git clone https://github.com/albertozafra7/leLab.git
cd leLab
uv tool install --editable .
lelab
```

An editable install resolves backend modules from the checkout. Production mode serves the committed `frontend/dist`; `lelab --dev` serves `frontend/src` through Vite.

---

### 2.1 `lelab/dataset_edit.py` — NEW FILE: Dataset editing backend

Full new module implementing:
- `handle_get_editable_datasets()` — list local datasets with episode/frame counts
- `handle_start_merge()` / `handle_merge_status()` — background merge via `lerobot.datasets.dataset_tools.merge_datasets`
- `handle_delete_episodes()` — delete by index, save as new dataset (non-destructive)
- `handle_delete_episodes_inplace()` — delete and write back to same repo_id via atomic temp-dir swap
- `handle_get_episodes()` — list episodes from a dataset using HF `Dataset` API (`eps[i]`, not pandas)
- `handle_get_episode_video_info()` — return per-camera video file path + `from_timestamp`/`to_timestamp` for one episode
- `handle_serve_video_file()` — resolve + path-traversal-validate a video file for streaming

Request models added: `MergeRequest`, `DeleteEpisodesRequest`, `DeleteEpisodesInplaceRequest`.

---

### 2.2 `lelab/record.py` — Recording backend extensions

**Changes:**

- **Camera feed streaming** — added `current_robot` global (set when cameras connect, cleared on teardown) + `camera_feed_frames()` generator that reads `cam.read_latest()` and yields MJPEG frames. Gracefully handles `TimeoutError` and `RuntimeError`.
- **Teardown-safe camera reads** — each stream iteration snapshots `current_robot` once before reading its cameras, preventing a teardown race where the global becomes `None` between the state check and dereference.
- **Recording status** — added `cameras` list to the status response (names of configured cameras).
- **H.264 encoder** — force `libx264` + `ultrafast` preset via `CameraConfig.encoder_override` to ensure low-latency hardware-independent encoding.
- **Pause/Resume** — added `recording_paused: bool` global and `_pause_resume_event: threading.Event`. `handle_pause_recording()` clears the event and triggers `exit_early` to end the current phase; the main recording loop calls `_pause_resume_event.wait()` between episodes. `handle_resume_recording()` sets the event.
- **Pause state in `available_controls`** — status response exposes `pause_recording` and `resume_recording` based on current state.
- **Phase tracking** — added `"paused"` to the set of valid phases (`"preparing"`, `"recording"`, `"resetting"`, `"paused"`, `"completed"`, `"error"`).
- **Session reset** — `recording_paused = False` and `_pause_resume_event.set()` at the start of every new session.

---

### 2.3 `lelab/jobs.py` — Training job pause/resume

**Changes:**

- **`JobState`** extended: `"paused"` added alongside `"running"`, `"done"`, `"failed"`, `"interrupted"`.
- **`JobRegistry.pause(job_id)`** — sends `SIGSTOP` to the training subprocess PID, sets `record.state = "paused"`, persists metadata.
- **`JobRegistry.resume(job_id)`** — sends `SIGCONT`, restores `record.state = "running"`, persists metadata.
- **`JobRegistry.stop()`** — updated to accept both `"running"` and `"paused"` states; sends `SIGCONT` before `SIGTERM` when stopping a paused job so it can shut down cleanly.
- Polling guards updated to also continue while state is `"paused"`.
- **`JobRegistry.rename(job_id, name)`** — validates and persists a new display name in the job metadata, then notifies subscribers.

---

### 2.4 `lelab/server.py` — New API endpoints

**New endpoints added:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/edit/datasets` | List local datasets for the Edit UI |
| `POST` | `/edit/merge` | Start background dataset merge |
| `GET` | `/edit/merge-status` | Poll merge progress |
| `POST` | `/edit/delete-episodes` | Delete episodes → new dataset (copy) |
| `POST` | `/edit/delete-episodes-inplace` | Delete episodes → overwrite source dataset (atomic swap) |
| `GET` | `/dataset-episodes` | List episodes for a dataset (episode index, length, task) |
| `GET` | `/camera-feed/{cam_key}` | MJPEG streaming for a live camera |
| `GET` | `/dataset-episode-video-info` | Per-camera video file path + timestamps for one episode |
| `GET` | `/dataset-video-file` | Serve a local video file (supports HTTP Range, for replay) |
| `POST` | `/pause-recording` | Pause recording between episodes |
| `POST` | `/resume-recording` | Resume recording from pause |
| `POST` | `/jobs/{job_id}/pause` | Pause a running training job (SIGSTOP) |
| `POST` | `/jobs/{job_id}/resume` | Resume a paused training job (SIGCONT) |
| `PATCH` | `/jobs/{job_id}` | Rename a training job persistently |

The recording camera endpoint accesses `_record.recording_active` and `_record.camera_feed_frames` through the module rather than importing the boolean by value, so it observes current recording state after sessions start or stop.

---

### 2.5 `frontend/src/pages/EditDataset.tsx` — NEW/REPLACED: Dataset editor UI

The original file was a stub. Replaced with a full two-tab interface:

- **Merge tab** — checkbox dataset picker, output name field, progress log, live status polling
- **Delete Episodes tab** — source dataset dropdown, episode index input, optional output name, non-destructive delete

---

### 2.6 `frontend/src/pages/Recording.tsx` — Live camera feeds + Pause/Resume

**Changes:**

- **`BackendStatus`** interface extended: added `recording_paused`, `cameras?: string[]`, `pause_recording` / `resume_recording` in `available_controls`.
- **`Phase` type** extended with `"paused"`.
- **Camera layout** — added `cameraAreaRef`, `cameraArea` state (ResizeObserver), `cameraWindow` computed layout for optimal grid fitting. Uses `h-screen flex flex-col` outer container with `flex-1 min-h-0` camera card so ResizeObserver gets a real height.
- **`CameraFeed` component** — `<img>` element consuming `multipart/x-mixed-replace` MJPEG stream from `/camera-feed/{key}`. Mounts only when cameras are available.
- **Pause/Resume buttons** — amber `⏸` button when `pause_recording` is available; green `▶` button when `resume_recording` is available. Show inline in the controls bar.
- **Paused phase** — amber colour scheme, status text `"⏸ PAUSED — CLICK RESUME TO CONTINUE"`.
- **`handlePauseRecording` / `handleResumeRecording`** — POST to new endpoints.

---

### 2.7 `frontend/src/pages/RerecordEpisode.tsx` — NEW: Add/Re-record episodes

Full new page implementing a 2-column workflow:

**Left column — episode selection:**
- Dataset picker (fetches `/edit/datasets`)
- Episode grid — loads from `/dataset-episodes`, shows `#index`, frame count, task text
- Checkbox selection for episodes to delete before re-recording
- **▶ Play button** on each episode card — opens replay modal

**Right column — recording config:**
- Robot selection (reuses `useRobots` hook)
- Camera configuration (reuses `CameraConfiguration` component)
- Episode count, time per episode, reset time, task description
- `Delete selected + Start Recording` button — calls `/edit/delete-episodes-inplace` then `/start-recording` with `resume=True`

**`EpisodeReplayModal` component (inline):**
- Fetches `/dataset-episode-video-info` on open
- Renders `<video>` elements per camera with `src="/dataset-video-file?...#t={from},{to}"`
- `onLoadedMetadata` seeks to `from_timestamp`; `onTimeUpdate` loops within the episode segment
- 2-column grid for multi-camera datasets

---

### 2.8 `frontend/src/pages/Landing.tsx` — New entry points

- Added **Edit Datasets** card with "Merge & Edit" button → `/edit-dataset`
- Added **Add / Re-record** button (RefreshCw icon) inside the Edit Datasets card → `/rerecord`

---

### 2.9 `frontend/src/App.tsx` — New routes

Added:
- `/rerecord` → `RerecordEpisode`

(`/edit-dataset` was already present from the original LeLab.)

---

### 2.10 `frontend/src/pages/Training.tsx` — Training Pause/Resume

**Changes:**

- Imports `pauseJob`, `resumeJob` from `jobsApi`
- `Pause` icon added to lucide imports
- `jobToStatus()` updated: `training_active` is `true` for both `"running"` and `"paused"` states; `available_controls.pause_training` / `resume_training` reflect actual state
- `isPaused` / `isActive` derived booleans
- `handlePause()` / `handleResume()` handlers
- Header button area: when active shows **⏸ Pause** + **■ Stop** (or **▶ Resume** + **■ Stop** when paused)
- Polling intervals updated to continue while `state === "paused"`
- Training requests can include `policy_path` to initialize a new fine-tuning run from a selected checkpoint.
- Diffusion-only configuration values are forwarded when `policy_type === "diffusion"`.
- Start validation requires a selected checkpoint when fine-tuning is enabled.
- Added a pencil action that renames the current network through `PATCH /jobs/{job_id}`.

---

### 2.11 `frontend/src/lib/jobsApi.ts` — New API functions

Added:
- `pauseJob(baseUrl, fetcher, id)` — `POST /jobs/{id}/pause`
- `resumeJob(baseUrl, fetcher, id)` — `POST /jobs/{id}/resume`
- `renameJob(baseUrl, fetcher, id, name)` — `PATCH /jobs/{id}`
- `JobState` includes `"paused"`; training request types include `policy_path` and Diffusion-specific fields.

---

### 2.12 `frontend/src/components/jobs/JobCard.tsx` — Paused-job handling

- Added the paused state presentation and icon.
- Paused jobs remain active in the list: they retain progress, elapsed-time display, and the Stop action instead of being treated as completed jobs.

---

### 2.13 Training configuration components — Fine-tuning + Diffusion policy

**Files:**

- `frontend/src/components/training/ConfigurationTab.tsx`
- `frontend/src/components/training/types.ts`
- `frontend/src/components/training/config/AdvancedCard.tsx`
- `frontend/src/components/training/config/FineTuneCard.tsx` — new
- `frontend/src/components/training/config/DiffusionCard.tsx` — new

**Changes:**

- Added **Model Initialization**, which lists completed/imported jobs with checkpoints compatible with the selected policy, loads their checkpoints, selects the latest by default, and stores the selected checkpoint reference as `policy_path`.
- Fine-tuning starts a new run from policy weights only; it does not restore optimizer state.
- Removed the misleading generic **Resume from Checkpoint** toggle. `resume` remains reserved for continuing an interrupted run with its optimizer state.
- Added a Diffusion-only card covering observation/action horizons, image encoder and U-Net settings, noise scheduler, diffusion timesteps, prediction type, sample clipping, and padded-action loss masking.
- Diffusion defaults are seeded when the policy is selected and omitted entirely for other policy types.

---

### 2.14 `lelab/train.py` + `tests/test_train.py` — Training command support

- `TrainingRequest` accepts `policy_path` and all Diffusion-specific options exposed by the frontend.
- A selected checkpoint emits `--policy.path=...` instead of `--policy.type`, creating a fresh fine-tuning run.
- Policy overrides use joined `--policy.option=value` arguments when loading a pretrained policy, matching LeRobot's path-field parser and override handling.
- Local Hub checkpoint references are resolved through the existing rollout checkpoint resolver.
- HF Cloud accepts a model repository's root/final checkpoint but rejects a specific `@checkpoints/...` reference, which is local-training only.
- Diffusion options are emitted only for Diffusion policies; booleans are encoded in CLI-compatible lowercase form.
- Tests cover pretrained path handling, Diffusion-only flag emission, and HF Cloud checkpoint restrictions.

---

## Part 3 — Build & Deploy Frontend

For local frontend development, run `lelab --dev`; no production rebuild is required while developing.

To test or refresh the production bundle locally, use Node.js 22 (Vite 8 requires Node.js `^20.19.0` or `>=22.12.0`):

```bash
cd frontend
npm ci
npm run build
```

On `main`, `.github/workflows/build_frontend.yml` automatically rebuilds and commits `frontend/dist` whenever frontend source changes. Do not copy bundles into `site-packages` or replace the STL mesh directory manually.

---

## Part 4 — Known Behaviours & Side Effects

| Behaviour | Detail |
|-----------|--------|
| One parquet per episode | The crash-safety change closes the data writer after every episode. Datasets now use one parquet file per episode rather than packing multiples up to a size limit. |
| Delete Episodes is non-destructive | The original dataset is always preserved unless `delete-episodes-inplace` is used explicitly. |
| Merge is non-destructive | Source datasets are unchanged; the merged result is a new local dataset. |
| Training pause is local-only | SIGSTOP/SIGCONT works only for local runner jobs. HF Cloud jobs cannot be paused this way. |
| Recording pause saves the current episode | Pausing between episodes is safe; mid-episode pause is not supported (the current episode finishes first). |
| Video replay uses HTML5 media fragments | `#t=start,end` in the video `src` URL is used to seek to the right position in a shared `.mp4` file. Browser support is universal for mp4. |

---

## Part 5 — Inference Camera Feeds

### 5.1 `lelab/inference_preview.py` + `lelab/rollout.py` — Preview cameras during inference

**Context:** Inference owns its cameras inside a rollout subprocess. Opening a second `OpenCVCamera` in the server process is unreliable for devices/backends that allow only one reader, so the camera-owning subprocess now publishes frames from observations it already captured.

**Changes:**

- Added `lelab/inference_preview.py`, a wrapper around `lerobot.scripts.lerobot_rollout`.
- The wrapper installs a hook on `RolloutStrategy._process_observation_and_notify` and publishes configured RGB/RGBA observation frames as JPEG files at 5 FPS.
- Camera keys are mapped to deterministic SHA-256-based filenames; each frame is written to a temporary file and atomically replaced so readers never receive a partial JPEG.
- `handle_start_inference()` launches `python -m lelab.inference_preview` and passes a per-run preview directory plus camera keys through environment variables.
- `inference_camera_feed_frames()` reads new JPEG snapshots from that directory and exposes them as MJPEG without opening camera hardware in the server process.
- Preview state is lock-protected and temporary files are removed on startup failure, explicit stop, and natural subprocess exit.
- `handle_inference_status()` exposes `"cameras": list(_inference_camera_keys)` while the preview is active.

---

### 5.2 `lelab/server.py` — Inference camera feed endpoint

- Imports `inference_camera_feed_frames` from `.rollout`.
- Added endpoint: `GET /inference-camera-feed/{cam_key}` — returns `StreamingResponse` with `multipart/x-mixed-replace` MJPEG stream.

---

### 5.3 `frontend/src/lib/inferenceApi.ts` — Updated `InferenceStatus`

- Added `cameras?: string[]` field.

---

### 5.4 `frontend/src/pages/Inference.tsx` — Camera feed display

**Changes:**

- Layout uses `h-screen flex flex-col overflow-hidden` so the camera area fills the available viewport.
- `cameras` and `hasCameras` derived from `status?.cameras`.
- Added a `ResizeObserver` and an aspect-ratio-aware packing calculation to maximize each camera window for any camera count.
- Camera windows are centered inside the status card and consume `/inference-camera-feed/{key}` as MJPEG, with an overlaid short camera name.
- Setup/rollout status, timer, progress, policy name, and Stop control remain visible without page scrolling.
