import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CheckpointDropdown from '@/components/jobs/CheckpointDropdown';
import { useApi } from '@/contexts/ApiContext';
import { JobCheckpoint, listJobCheckpoints } from '@/lib/checkpointsApi';
import { JobRecord, listJobs } from '@/lib/jobsApi';
import { ConfigComponentProps } from '../types';

const FineTuneCard: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  const { baseUrl, fetchWithHeaders } = useApi();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [checkpoints, setCheckpoints] = useState<JobCheckpoint[]>([]);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    listJobs(baseUrl, fetchWithHeaders, 200)
      .then(setJobs)
      .catch(() => setJobs([]));
  }, [baseUrl, fetchWithHeaders]);

  const compatibleJobs = useMemo(
    () => jobs.filter((job) => job.checkpoint_count > 0 && job.config.policy_type === config.policy_type),
    [config.policy_type, jobs],
  );

  useEffect(() => {
    if (!selectedJobId || compatibleJobs.some((job) => job.id === selectedJobId)) return;
    setSelectedJobId('');
    setCheckpoints([]);
    setSelectedStep(null);
    updateConfig('policy_path', undefined);
  }, [compatibleJobs, selectedJobId, updateConfig]);

  const selectJob = async (jobId: string) => {
    setSelectedJobId(jobId);
    setCheckpoints([]);
    setSelectedStep(null);
    updateConfig('policy_path', undefined);
    setLoading(true);
    try {
      const next = await listJobCheckpoints(baseUrl, fetchWithHeaders, jobId);
      setCheckpoints(next);
      const latest = next.at(-1);
      if (latest) {
        setSelectedStep(latest.step);
        updateConfig('policy_path', latest.ref);
      }
    } finally {
      setLoading(false);
    }
  };

  const selectCheckpoint = (step: number) => {
    setSelectedStep(step);
    updateConfig('policy_path', checkpoints.find((checkpoint) => checkpoint.step === step)?.ref);
  };

  const toggleEnabled = (checked: boolean) => {
    updateConfig('fine_tune', checked);
    if (!checked) {
      setSelectedJobId('');
      setCheckpoints([]);
      setSelectedStep(null);
      updateConfig('policy_path', undefined);
    }
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-white">Model Initialization</CardTitle>
          <div className="flex items-center gap-3">
            <Switch id="fine_tune" checked={config.fine_tune} onCheckedChange={toggleEnabled} />
            <Label htmlFor="fine_tune" className="text-slate-300">Fine-tune a trained model</Label>
          </div>
        </div>
      </CardHeader>
      {config.fine_tune && (
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="fine_tune_model" className="text-slate-300">Trained Model</Label>
            <Select value={selectedJobId || undefined} onValueChange={selectJob}>
              <SelectTrigger id="fine_tune_model" className="bg-slate-900 border-slate-600 text-white">
                <SelectValue placeholder={`Select a trained ${config.policy_type} model`} />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600 text-white">
                {compatibleJobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>{job.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {compatibleJobs.length === 0 && (
              <p className="text-xs text-amber-300 mt-2">
                No saved checkpoints match the selected policy. Import a model from the Jobs page or train one first.
              </p>
            )}
          </div>
          {selectedJobId && (
            <div>
              <Label className="text-slate-300">Checkpoint</Label>
              <div className="mt-1">
                <CheckpointDropdown
                  checkpoints={checkpoints}
                  selectedStep={selectedStep}
                  onChange={selectCheckpoint}
                  disabled={loading}
                  placeholder={loading ? 'Loading…' : 'Select checkpoint'}
                />
              </div>
            </div>
          )}
          <p className="text-xs text-slate-500">
            This loads the selected policy weights into a new run. It does not restore optimizer state.
          </p>
        </CardContent>
      )}
    </Card>
  );
};

export default FineTuneCard;
