# Copyright 2025 The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Training-specific helpers: the request schema and the LeRobot CLI builder.

The actual job lifecycle (subprocess management, registry, log streaming)
lives in app/jobs.py.
"""

import json
import re
from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from lelab.jobs import JobTarget

_SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]+")


class TrainingRequest(BaseModel):
    # Dataset configuration
    dataset_repo_id: str
    dataset_revision: str | None = None
    dataset_root: str | None = None
    dataset_episodes: list[int] | None = None
    dataset_image_transforms_enable: bool = False

    # Policy configuration
    policy_type: str = "act"
    policy_path: str | None = None

    # Core training parameters
    steps: int = 10000
    batch_size: int = 8
    seed: int | None = 1000
    num_workers: int = 4

    # Logging and checkpointing
    log_freq: int = 250
    save_freq: int = 1000
    env_eval_freq: int = 0
    save_checkpoint: bool = True

    # Output configuration
    output_dir: str = "outputs/train"
    resume: bool = False
    job_name: str | None = None

    # Weights & Biases
    wandb_enable: bool = False
    wandb_project: str | None = None
    wandb_entity: str | None = None
    wandb_notes: str | None = None
    wandb_run_id: str | None = None
    wandb_mode: str | None = "online"
    wandb_disable_artifact: bool = False

    # Environment / evaluation
    env_type: str | None = None
    env_task: str | None = None
    eval_n_episodes: int = 10
    eval_batch_size: int = 50
    eval_use_async_envs: bool = False

    # Policy-specific
    policy_device: str | None = "cuda"
    policy_use_amp: bool = False
    # Hub upload (set by HfCloudJobRunner; not exposed in the form)
    policy_push_to_hub: bool = False
    policy_repo_id: str | None = None

    # GR00T-specific policy options (only emitted when policy_type == "groot";
    # these flags don't exist on other policy configs, so draccus would reject
    # them). All optional — unset fields fall back to the groot config defaults.
    policy_base_model_path: str | None = None
    policy_embodiment_tag: str | None = None
    policy_chunk_size: int | None = None
    policy_n_action_steps: int | None = None
    policy_use_relative_actions: bool | None = None
    policy_relative_exclude_joints: list[str] | None = None
    policy_use_bf16: bool | None = None

    # Diffusion-specific policy options.
    diffusion_n_obs_steps: int | None = None
    diffusion_horizon: int | None = None
    diffusion_n_action_steps: int | None = None
    diffusion_drop_n_last_frames: int | None = None
    diffusion_vision_backbone: str | None = None
    diffusion_crop_is_random: bool | None = None
    diffusion_use_group_norm: bool | None = None
    diffusion_use_separate_rgb_encoder_per_camera: bool | None = None
    diffusion_kernel_size: int | None = None
    diffusion_n_groups: int | None = None
    diffusion_step_embed_dim: int | None = None
    diffusion_use_film_scale_modulation: bool | None = None
    diffusion_noise_scheduler_type: str | None = None
    diffusion_num_train_timesteps: int | None = None
    diffusion_beta_schedule: str | None = None
    diffusion_prediction_type: str | None = None
    diffusion_clip_sample: bool | None = None
    diffusion_clip_sample_range: float | None = None
    diffusion_num_inference_steps: int | None = None
    diffusion_do_mask_loss_for_padding: bool | None = None

    # Optimizer
    optimizer_type: str | None = "adam"
    optimizer_lr: float | None = None
    optimizer_weight_decay: float | None = None
    optimizer_grad_clip_norm: float | None = None

    # Advanced
    use_policy_training_preset: bool = True
    config_path: str | None = None


def build_training_command(
    request: TrainingRequest,
    output_dir: str,
    python_executable: str = "python",
    job_target: "JobTarget | None" = None,
) -> list[str]:
    """Build the argv list to invoke `<python_executable> -m lerobot.scripts.lerobot_train`.

    `output_dir` is supplied separately from the request so the caller (the
    JobRegistry) can pin it to the per-job directory rather than relying on
    request.output_dir, which the frontend doesn't even send in the new world.

    `python_executable` defaults to "python" for the cloud runner (whose
    container has lerobot on PATH); the local runner must pass sys.executable
    so the subprocess uses the same interpreter as lelab itself — otherwise
    PATH lookup picks up a different env (uv tool venv, miniforge3 base, etc.)
    that lacks lerobot.
    """
    cmd: list[str] = [python_executable, "-m", "lerobot.scripts.lerobot_train"]
    has_pretrained_policy = request.policy_path is not None

    def add_policy_option(name: str, value: str) -> None:
        flag = f"--policy.{name}"
        if has_pretrained_policy:
            # LeRobot's path-field parser only recognizes joined arguments. It
            # also removes every --policy.* token before loading the checkpoint,
            # then reapplies them through get_cli_overrides().
            cmd.append(f"{flag}={value}")
        else:
            cmd.extend([flag, value])

    # Dataset
    cmd.extend(["--dataset.repo_id", request.dataset_repo_id])
    if request.dataset_revision:
        cmd.extend(["--dataset.revision", request.dataset_revision])
    if request.dataset_root:
        cmd.extend(["--dataset.root", request.dataset_root])
    if request.dataset_episodes:
        cmd.extend(["--dataset.episodes"] + [str(ep) for ep in request.dataset_episodes])
    if request.dataset_image_transforms_enable:
        cmd.extend(["--dataset.image_transforms.enable", "true"])

    # Policy. Loading a checkpoint initializes a new fine-tuning run; `resume`
    # remains reserved for continuing the optimizer state of an interrupted run.
    if request.policy_path:
        policy_path = request.policy_path
        if "@checkpoints/" in policy_path or policy_path.endswith("@root"):
            if job_target is not None and job_target.runner == "hf_cloud":
                if policy_path.endswith("@root"):
                    policy_path = policy_path.removesuffix("@root")
                else:
                    raise ValueError(
                        "Fine-tuning a specific Hub checkpoint is only supported for local training. "
                        "Use the model repository's final checkpoint for HF Cloud training."
                    )
            else:
                from .rollout import _resolve_policy_path

                policy_path = _resolve_policy_path(policy_path)
        cmd.append(f"--policy.path={policy_path}")
    else:
        cmd.extend(["--policy.type", request.policy_type])

    # Core training params
    cmd.extend(["--steps", str(request.steps)])
    cmd.extend(["--batch_size", str(request.batch_size)])
    cmd.extend(["--num_workers", str(request.num_workers)])
    if request.seed is not None:
        cmd.extend(["--seed", str(request.seed)])

    # Policy device / AMP / hub
    if request.policy_device:
        add_policy_option("device", request.policy_device)
    add_policy_option("use_amp", "true" if request.policy_use_amp else "false")
    # On HF Cloud, lerobot's submit_to_hf owns the model repo and sets push_to_hub on
    # the pod itself; _pod_forwarded_args drops any --policy.push_to_hub/--policy.repo_id
    # we'd pass, so we must not emit them. Local runs keep the existing behavior:
    # LeRobot defaults push_to_hub=True and demands --policy.repo_id when so.
    is_cloud = job_target is not None and job_target.runner == "hf_cloud"
    if not is_cloud:
        add_policy_option("push_to_hub", "true" if request.policy_push_to_hub else "false")
        if request.policy_push_to_hub and request.policy_repo_id:
            add_policy_option("repo_id", request.policy_repo_id)

    # GR00T-specific policy flags. These options only exist on the groot config,
    # so emit them only for --policy.type=groot; sending them to another policy
    # would make draccus abort the run. Each is skipped when unset so the groot
    # config's own defaults apply.
    if request.policy_type == "groot":
        if request.policy_base_model_path:
            add_policy_option("base_model_path", request.policy_base_model_path)
        if request.policy_embodiment_tag:
            add_policy_option("embodiment_tag", request.policy_embodiment_tag)
        if request.policy_chunk_size is not None:
            add_policy_option("chunk_size", str(request.policy_chunk_size))
        if request.policy_n_action_steps is not None:
            add_policy_option("n_action_steps", str(request.policy_n_action_steps))
        if request.policy_use_relative_actions is not None:
            add_policy_option(
                "use_relative_actions", "true" if request.policy_use_relative_actions else "false"
            )
        if request.policy_relative_exclude_joints is not None:
            # draccus parses list values from a single JSON token, e.g. '["gripper"]'.
            add_policy_option(
                "relative_exclude_joints", json.dumps(request.policy_relative_exclude_joints)
            )
        if request.policy_use_bf16 is not None:
            add_policy_option("use_bf16", "true" if request.policy_use_bf16 else "false")

    if request.policy_type == "diffusion":
        diffusion_options = {
            "n_obs_steps": request.diffusion_n_obs_steps,
            "horizon": request.diffusion_horizon,
            "n_action_steps": request.diffusion_n_action_steps,
            "drop_n_last_frames": request.diffusion_drop_n_last_frames,
            "vision_backbone": request.diffusion_vision_backbone,
            "crop_is_random": request.diffusion_crop_is_random,
            "use_group_norm": request.diffusion_use_group_norm,
            "use_separate_rgb_encoder_per_camera": request.diffusion_use_separate_rgb_encoder_per_camera,
            "kernel_size": request.diffusion_kernel_size,
            "n_groups": request.diffusion_n_groups,
            "diffusion_step_embed_dim": request.diffusion_step_embed_dim,
            "use_film_scale_modulation": request.diffusion_use_film_scale_modulation,
            "noise_scheduler_type": request.diffusion_noise_scheduler_type,
            "num_train_timesteps": request.diffusion_num_train_timesteps,
            "beta_schedule": request.diffusion_beta_schedule,
            "prediction_type": request.diffusion_prediction_type,
            "clip_sample": request.diffusion_clip_sample,
            "clip_sample_range": request.diffusion_clip_sample_range,
            "num_inference_steps": request.diffusion_num_inference_steps,
            "do_mask_loss_for_padding": request.diffusion_do_mask_loss_for_padding,
        }
        for option, value in diffusion_options.items():
            if value is not None:
                encoded = str(value).lower() if isinstance(value, bool) else str(value)
                add_policy_option(option, encoded)

    # Logging / checkpointing
    cmd.extend(["--log_freq", str(request.log_freq)])
    cmd.extend(["--save_freq", str(request.save_freq)])
    cmd.extend(["--env_eval_freq", str(request.env_eval_freq)])
    cmd.extend(["--save_checkpoint", "true" if request.save_checkpoint else "false"])

    # Output. On HF Cloud the pod, not this host, runs the trainer: an absolute host
    # output_dir (e.g. ~/.cache/.../outputs/train) is baked into the staged config and
    # the pod crashes trying to mkdir it under /Users. Checkpoints land on the Hub repo
    # anyway, so we omit it for cloud and let lerobot pick its in-pod default.
    if not is_cloud:
        cmd.extend(["--output_dir", output_dir])
    cmd.extend(["--resume", "true" if request.resume else "false"])
    if request.job_name:
        cmd.extend(["--job_name", request.job_name])

    # W&B
    cmd.extend(["--wandb.enable", "true" if request.wandb_enable else "false"])
    if request.wandb_enable:
        if request.wandb_project:
            cmd.extend(["--wandb.project", request.wandb_project])
        if request.wandb_entity:
            cmd.extend(["--wandb.entity", request.wandb_entity])
        if request.wandb_notes:
            cmd.extend(["--wandb.notes", request.wandb_notes])
        if request.wandb_run_id:
            cmd.extend(["--wandb.run_id", request.wandb_run_id])
        if request.wandb_mode:
            cmd.extend(["--wandb.mode", request.wandb_mode])
        cmd.extend(["--wandb.disable_artifact", "true" if request.wandb_disable_artifact else "false"])

    # Env
    if request.env_type:
        cmd.extend(["--env.type", request.env_type])
    if request.env_task:
        cmd.extend(["--env.task", request.env_task])

    # Eval
    cmd.extend(["--eval.n_episodes", str(request.eval_n_episodes)])
    cmd.extend(["--eval.batch_size", str(request.eval_batch_size)])
    cmd.extend(["--eval.use_async_envs", "true" if request.eval_use_async_envs else "false"])

    # Optimizer
    if request.optimizer_type:
        cmd.extend(["--optimizer.type", request.optimizer_type])
    if request.optimizer_lr is not None:
        cmd.extend(["--optimizer.lr", str(request.optimizer_lr)])
    if request.optimizer_weight_decay is not None:
        cmd.extend(["--optimizer.weight_decay", str(request.optimizer_weight_decay)])
    if request.optimizer_grad_clip_norm is not None:
        cmd.extend(["--optimizer.grad_clip_norm", str(request.optimizer_grad_clip_norm)])

    # Advanced
    cmd.extend(["--use_policy_training_preset", "true" if request.use_policy_training_preset else "false"])
    if request.config_path:
        cmd.extend(["--config_path", request.config_path])

    # HF Jobs: --job.target=<flavor> dispatches the run remotely (lerobot commit #3856).
    # Image/timeout use lerobot's JobConfig defaults. lelab tags its jobs; lerobot always
    # adds a "lerobot" tag too. A pod's local checkpoints die with it, so push each one to
    # the model repo's checkpoints/<step>/ tree (the native replacement for lelab's old
    # in-pod uploader) — that's what makes the trained checkpoints reachable afterwards.
    if is_cloud and job_target.flavor:
        cmd.extend(["--job.target", job_target.flavor])
        cmd.extend(["--job.tags", '["lelab"]'])
        # save_checkpoint_to_hub needs policy.repo_id, which submit_to_hf only sets on the
        # fresh-run path; on a resume it isn't set before validate(), so the flag would
        # abort the submit. A resume already pushes back to its source repo, so skip it.
        if request.save_checkpoint and not request.resume:
            cmd.extend(["--save_checkpoint_to_hub", "true"])

    return cmd
