import React, { useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigComponentProps, TrainingConfig } from '../types';

const DEFAULTS: Partial<TrainingConfig> = {
  diffusion_n_obs_steps: 2,
  diffusion_horizon: 64,
  diffusion_n_action_steps: 32,
  diffusion_drop_n_last_frames: 7,
  diffusion_vision_backbone: 'resnet18',
  diffusion_crop_is_random: true,
  diffusion_use_group_norm: false,
  diffusion_use_separate_rgb_encoder_per_camera: true,
  diffusion_kernel_size: 5,
  diffusion_n_groups: 8,
  diffusion_step_embed_dim: 128,
  diffusion_use_film_scale_modulation: true,
  diffusion_noise_scheduler_type: 'DDPM',
  diffusion_num_train_timesteps: 100,
  diffusion_beta_schedule: 'squaredcos_cap_v2',
  diffusion_prediction_type: 'epsilon',
  diffusion_clip_sample: true,
  diffusion_clip_sample_range: 1,
  diffusion_do_mask_loss_for_padding: false,
};

const DiffusionCard: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  const isDiffusion = config.policy_type === 'diffusion';
  const seededDefaults = useRef(false);

  useEffect(() => {
    if (!isDiffusion) {
      seededDefaults.current = false;
      return;
    }
    if (seededDefaults.current) return;
    seededDefaults.current = true;
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const typedKey = key as keyof TrainingConfig;
      if (config[typedKey] === undefined) {
        updateConfig(typedKey, value as never);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDiffusion]);

  if (!isDiffusion) return null;

  const integerField = (
    key: keyof TrainingConfig,
    label: string,
    options?: { optional?: boolean; min?: number },
  ) => (
    <div>
      <Label htmlFor={key} className="text-slate-300">{label}</Label>
      <NumberInput
        id={key}
        value={config[key] as number | undefined}
        min={options?.min}
        onChange={(value) => {
          if (value !== undefined || options?.optional) updateConfig(key, value as never);
        }}
        placeholder={options?.optional ? 'Policy default' : undefined}
        className="bg-slate-900 border-slate-600 text-white rounded-lg"
      />
    </div>
  );

  const toggle = (key: keyof TrainingConfig, label: string) => (
    <div className="flex items-center space-x-3">
      <Switch
        id={key}
        checked={Boolean(config[key])}
        onCheckedChange={(checked) => updateConfig(key, checked as never)}
      />
      <Label htmlFor={key} className="text-slate-300">{label}</Label>
    </div>
  );

  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="text-white">Diffusion Policy Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-7">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {integerField('diffusion_n_obs_steps', 'Observation Steps', { min: 1 })}
          {integerField('diffusion_horizon', 'Prediction Horizon', { min: 1 })}
          {integerField('diffusion_n_action_steps', 'Action Steps', { min: 1 })}
          {integerField('diffusion_drop_n_last_frames', 'Drop Last Frames', { min: 0 })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="diffusion_vision_backbone" className="text-slate-300">Vision Backbone</Label>
            <Input
              id="diffusion_vision_backbone"
              value={config.diffusion_vision_backbone ?? ''}
              onChange={(event) => updateConfig('diffusion_vision_backbone', event.target.value)}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
          {integerField('diffusion_kernel_size', 'U-Net Kernel Size', { min: 1 })}
          {integerField('diffusion_n_groups', 'Group Norm Groups', { min: 1 })}
          {integerField('diffusion_step_embed_dim', 'Step Embedding Size', { min: 1 })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {toggle('diffusion_crop_is_random', 'Random Image Crop')}
          {toggle('diffusion_use_group_norm', 'Use Group Norm in Backbone')}
          {toggle('diffusion_use_separate_rgb_encoder_per_camera', 'Separate Encoder per Camera')}
          {toggle('diffusion_use_film_scale_modulation', 'FiLM Scale Modulation')}
          {toggle('diffusion_do_mask_loss_for_padding', 'Mask Loss for Padded Actions')}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="diffusion_noise_scheduler_type" className="text-slate-300">Noise Scheduler</Label>
            <Select
              value={config.diffusion_noise_scheduler_type ?? 'DDPM'}
              onValueChange={(value) => updateConfig('diffusion_noise_scheduler_type', value)}
            >
              <SelectTrigger id="diffusion_noise_scheduler_type" className="bg-slate-900 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600 text-white">
                <SelectItem value="DDPM">DDPM</SelectItem>
                <SelectItem value="DDIM">DDIM</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {integerField('diffusion_num_train_timesteps', 'Training Diffusion Steps', { min: 1 })}
          {integerField('diffusion_num_inference_steps', 'Inference Diffusion Steps', {
            optional: true,
            min: 1,
          })}
          <div>
            <Label htmlFor="diffusion_beta_schedule" className="text-slate-300">Beta Schedule</Label>
            <Select
              value={config.diffusion_beta_schedule ?? 'squaredcos_cap_v2'}
              onValueChange={(value) => updateConfig('diffusion_beta_schedule', value)}
            >
              <SelectTrigger id="diffusion_beta_schedule" className="bg-slate-900 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600 text-white">
                <SelectItem value="squaredcos_cap_v2">Squared Cosine</SelectItem>
                <SelectItem value="linear">Linear</SelectItem>
                <SelectItem value="scaled_linear">Scaled Linear</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="diffusion_prediction_type" className="text-slate-300">Prediction Type</Label>
            <Select
              value={config.diffusion_prediction_type ?? 'epsilon'}
              onValueChange={(value) => updateConfig('diffusion_prediction_type', value)}
            >
              <SelectTrigger id="diffusion_prediction_type" className="bg-slate-900 border-slate-600 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600 text-white">
                <SelectItem value="epsilon">Noise (epsilon)</SelectItem>
                <SelectItem value="sample">Sample</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="diffusion_clip_sample_range" className="text-slate-300">Clip Sample Range</Label>
            <NumberInput
              id="diffusion_clip_sample_range"
              integer={false}
              step="0.1"
              min={0}
              value={config.diffusion_clip_sample_range}
              onChange={(value) => updateConfig('diffusion_clip_sample_range', value)}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        </div>
        {toggle('diffusion_clip_sample', 'Clip Denoised Samples')}
        <p className="text-xs text-slate-500">
          The prediction horizon must be divisible by 2 raised to the number of U-Net downsampling stages.
        </p>
      </CardContent>
    </Card>
  );
};

export default DiffusionCard;
