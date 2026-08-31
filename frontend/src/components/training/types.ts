export interface TrainingConfig {
  target: { runner: "local" | "hf_cloud"; flavor?: string };

  // Dataset configuration
  dataset_repo_id: string;

  // Policy configuration
  policy_type: string;
  fine_tune: boolean;
  policy_path?: string;

  // Core training parameters
  steps: number;
  batch_size: number;
  seed?: number;
  num_workers: number;

  // Logging and checkpointing
  log_freq: number;
  save_freq: number;
  save_checkpoint: boolean;

  // Output configuration
  resume: boolean;

  // Weights & Biases
  wandb_enable: boolean;
  wandb_project?: string;
  wandb_entity?: string;
  wandb_notes?: string;
  wandb_mode?: string;
  wandb_disable_artifact: boolean;

  // Policy-specific parameters
  policy_device?: string;
  policy_use_amp: boolean;

  // Optimizer parameters
  optimizer_type?: string;
  optimizer_lr?: number;
  optimizer_weight_decay?: number;
  optimizer_grad_clip_norm?: number;

  // Advanced configuration
  use_policy_training_preset: boolean;

  // GR00T-specific configuration (only used when policy_type === "groot").
  dataset_image_transforms_enable?: boolean;
  policy_base_model_path?: string;
  policy_embodiment_tag?: string;
  policy_chunk_size?: number;
  policy_n_action_steps?: number;
  policy_use_relative_actions?: boolean;
  policy_relative_exclude_joints?: string[];
  policy_use_bf16?: boolean;

  // Diffusion-specific configuration (only used when policy_type === "diffusion").
  diffusion_n_obs_steps?: number;
  diffusion_horizon?: number;
  diffusion_n_action_steps?: number;
  diffusion_drop_n_last_frames?: number;
  diffusion_vision_backbone?: string;
  diffusion_crop_is_random?: boolean;
  diffusion_use_group_norm?: boolean;
  diffusion_use_separate_rgb_encoder_per_camera?: boolean;
  diffusion_kernel_size?: number;
  diffusion_n_groups?: number;
  diffusion_step_embed_dim?: number;
  diffusion_use_film_scale_modulation?: boolean;
  diffusion_noise_scheduler_type?: string;
  diffusion_num_train_timesteps?: number;
  diffusion_beta_schedule?: string;
  diffusion_prediction_type?: string;
  diffusion_clip_sample?: boolean;
  diffusion_clip_sample_range?: number;
  diffusion_num_inference_steps?: number;
  diffusion_do_mask_loss_for_padding?: boolean;
}

export interface TrainingStatus {
  training_active: boolean;
  current_step: number;
  total_steps: number;
  current_loss?: number;
  current_lr?: number;
  grad_norm?: number;
  epoch_time?: number;
  eta_seconds?: number;
  available_controls: {
    stop_training: boolean;
    pause_training: boolean;
    resume_training: boolean;
  };
}

export interface LogEntry {
  timestamp: number;
  message: string;
}

export interface ConfigComponentProps {
  config: TrainingConfig;
  updateConfig: <T extends keyof TrainingConfig>(
    key: T,
    value: TrainingConfig[T]
  ) => void;
}
