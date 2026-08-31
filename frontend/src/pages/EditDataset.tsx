import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Merge, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import { useHfAuth } from "@/contexts/HfAuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DatasetMeta {
  repo_id: string;
  last_modified: string | null;
  num_episodes: number | null;
  num_frames: number | null;
  fps: number | null;
  robot_type: string | null;
  tasks: string[];
  loadable: boolean;
}

interface MergeStatus {
  running: boolean;
  success: boolean | null;
  message: string;
  progress: string;
  output_repo_id: string | null;
  steps: string[];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function DatasetCard({
  ds,
  selected,
  onToggle,
}: {
  ds: DatasetMeta;
  selected: boolean;
  onToggle: () => void;
}) {
  const shortId = ds.repo_id.includes("/") ? ds.repo_id.split("/")[1] : ds.repo_id;
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
        selected
          ? "border-green-500 bg-green-500/10"
          : "border-gray-700 bg-gray-800 hover:border-gray-500"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
              selected ? "border-green-500 bg-green-500" : "border-gray-500"
            }`}
          >
            {selected && <Check className="w-3 h-3 text-black" />}
          </div>
          <span className="font-medium text-white truncate">{shortId}</span>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {ds.num_episodes !== null && (
            <Badge variant="secondary" className="text-xs bg-gray-700 text-gray-200">
              {ds.num_episodes} ep
            </Badge>
          )}
          {!ds.loadable && (
            <Badge variant="destructive" className="text-xs">
              unreadable
            </Badge>
          )}
        </div>
      </div>
      {ds.repo_id.includes("/") && (
        <p className="text-xs text-gray-500 mt-1 ml-6">{ds.repo_id}</p>
      )}
      {(ds.tasks ?? []).length > 0 && (
        <p className="text-xs text-gray-400 mt-1 ml-6 truncate">{(ds.tasks ?? [])[0]}</p>
      )}
    </button>
  );
}

function StepLog({ steps }: { steps: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  if (steps.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg bg-black/50 border border-gray-700 p-3 max-h-40 overflow-y-auto font-mono text-xs text-gray-300 space-y-1">
      {steps.map((s, i) => (
        <div key={i} className="leading-relaxed">
          <span className="text-gray-500 select-none">› </span>
          {s}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = "merge" | "delete";

const EditDataset: React.FC = () => {
  const navigate = useNavigate();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();
  const { auth } = useHfAuth();

  // Dataset list
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [loadingDatasets, setLoadingDatasets] = useState(true);

  // Active tab
  const [tab, setTab] = useState<Tab>("merge");

  // Merge state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outputName, setOutputName] = useState("");
  const [mergeStatus, setMergeStatus] = useState<MergeStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<string>("");
  const [deleteIndices, setDeleteIndices] = useState<string>("");
  const [deleteOutputName, setDeleteOutputName] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  // ── Fetch dataset list ───────────────────────────────────────────────────

  const fetchDatasets = useCallback(async () => {
    setLoadingDatasets(true);
    try {
      const r = await fetchWithHeaders(`${baseUrl}/edit/datasets`);
      if (r.ok) setDatasets(await r.json());
    } catch {
      toast({ title: "Could not load datasets", variant: "destructive" });
    } finally {
      setLoadingDatasets(false);
    }
  }, [baseUrl, fetchWithHeaders, toast]);

  useEffect(() => {
    fetchDatasets();
  }, [fetchDatasets]);

  // ── Merge polling ────────────────────────────────────────────────────────

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPoll = useCallback(() => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetchWithHeaders(`${baseUrl}/edit/merge-status`);
        if (!r.ok) return;
        const status: MergeStatus = await r.json();
        setMergeStatus(status);
        if (!status.running) {
          stopPoll();
          if (status.success) {
            toast({ title: "Merge complete!", description: status.message });
            fetchDatasets();
          } else if (status.success === false) {
            toast({ title: "Merge failed", description: status.message, variant: "destructive" });
          }
        }
      } catch {
        /* network hiccup — keep polling */
      }
    }, 1000);
  }, [baseUrl, fetchWithHeaders, toast, stopPoll, fetchDatasets]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  // ── Merge submit ─────────────────────────────────────────────────────────

  const handleMerge = async () => {
    if (selected.size < 2) {
      toast({ title: "Select at least 2 datasets", variant: "destructive" });
      return;
    }
    if (!outputName.trim()) {
      toast({ title: "Enter an output dataset name", variant: "destructive" });
      return;
    }

    const fullOutputId =
      auth.status === "authenticated"
        ? `${auth.username}/${outputName.trim()}`
        : outputName.trim();

    try {
      const r = await fetchWithHeaders(`${baseUrl}/edit/merge`, {
        method: "POST",
        body: JSON.stringify({
          source_repo_ids: Array.from(selected),
          output_repo_id: fullOutputId,
        }),
      });
      const data = await r.json();
      if (!data.success) {
        toast({ title: "Could not start merge", description: data.message, variant: "destructive" });
        return;
      }
      setMergeStatus({ running: true, success: null, message: "Starting…", progress: "starting", output_repo_id: fullOutputId, steps: [] });
      startPoll();
    } catch (e) {
      toast({ title: "Request failed", variant: "destructive" });
    }
  };

  // ── Delete submit ────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) {
      toast({ title: "Select a dataset", variant: "destructive" });
      return;
    }
    const raw = deleteIndices.split(/[\s,]+/).filter(Boolean);
    const indices = raw.map(Number);
    if (indices.some(isNaN)) {
      toast({ title: "Enter valid episode indices (comma or space separated)", variant: "destructive" });
      return;
    }
    if (indices.length === 0) {
      toast({ title: "Enter at least one episode index", variant: "destructive" });
      return;
    }

    const outputRepo = deleteOutputName.trim()
      ? auth.status === "authenticated"
        ? `${auth.username}/${deleteOutputName.trim()}`
        : deleteOutputName.trim()
      : undefined;

    setDeleting(true);
    try {
      const r = await fetchWithHeaders(`${baseUrl}/edit/delete-episodes`, {
        method: "POST",
        body: JSON.stringify({
          dataset_repo_id: deleteTarget,
          episode_indices: indices,
          output_repo_id: outputRepo ?? null,
        }),
      });
      const data = await r.json();
      if (data.success) {
        toast({ title: "Done!", description: data.message });
        setDeleteIndices("");
        setDeleteOutputName("");
        fetchDatasets();
      } else {
        toast({ title: "Delete failed", description: data.message, variant: "destructive" });
      }
    } catch {
      toast({ title: "Request failed", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const mergeRunning = mergeStatus?.running ?? false;
  const selectedDatasets = datasets.filter((d) => selected.has(d.repo_id));
  const totalEpisodes = selectedDatasets.reduce((s, d) => s + (d.num_episodes ?? 0), 0);

  const targetDataset = datasets.find((d) => d.repo_id === deleteTarget);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 w-full border-b border-gray-800 bg-black/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4">
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white" onClick={() => navigate("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <span className="font-semibold text-lg">Edit Datasets</span>
          <Button variant="ghost" size="icon" className="ml-auto text-gray-400 hover:text-white" onClick={fetchDatasets} disabled={loadingDatasets}>
            <RefreshCw className={`w-4 h-4 ${loadingDatasets ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-6 flex flex-col gap-6 flex-1">
        {/* Tab selector */}
        <div className="flex gap-1 p-1 bg-gray-900 rounded-lg w-fit border border-gray-700">
          {(["merge", "delete"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
                tab === t ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {t === "merge" ? "Merge Datasets" : "Delete Episodes"}
            </button>
          ))}
        </div>

        {/* ── MERGE TAB ─────────────────────────────────────────────────── */}
        {tab === "merge" && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
            {/* Dataset selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-200">Select datasets to merge</h2>
                {selected.size > 0 && (
                  <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setSelected(new Set())}>
                    Clear selection
                  </button>
                )}
              </div>

              {loadingDatasets ? (
                <div className="flex items-center gap-2 text-gray-400 py-8">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading datasets…</span>
                </div>
              ) : datasets.length === 0 ? (
                <p className="text-gray-500 text-sm py-8">No local datasets found. Record some first!</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pr-1">
                  {datasets.map((ds) => (
                    <DatasetCard
                      key={ds.repo_id}
                      ds={ds}
                      selected={selected.has(ds.repo_id)}
                      onToggle={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.has(ds.repo_id) ? next.delete(ds.repo_id) : next.add(ds.repo_id);
                          return next;
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Merge config panel */}
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-700 bg-gray-900 p-4 space-y-4">
                <h3 className="font-semibold text-gray-200">Merge configuration</h3>

                {/* Selection summary */}
                <div className="rounded-lg bg-gray-800 px-3 py-2 text-sm space-y-1">
                  <p className="text-gray-400">
                    Selected:{" "}
                    <span className="text-white font-medium">
                      {selected.size} dataset{selected.size !== 1 ? "s" : ""}
                    </span>
                  </p>
                  {selected.size > 0 && (
                    <p className="text-gray-400">
                      Total episodes:{" "}
                      <span className="text-white font-medium">{totalEpisodes}</span>
                    </p>
                  )}
                  {selected.size > 0 && (
                    <ul className="text-xs text-gray-500 mt-1 space-y-0.5">
                      {Array.from(selected).map((id) => (
                        <li key={id} className="truncate">› {id}</li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Output name */}
                <div className="space-y-1.5">
                  <Label className="text-gray-300 text-sm">Output dataset name</Label>
                  <div className="flex items-center gap-2">
                    {auth.status === "authenticated" && (
                      <span className="text-gray-500 text-sm flex-shrink-0">{auth.username}/</span>
                    )}
                    <Input
                      value={outputName}
                      onChange={(e) => setOutputName(e.target.value)}
                      placeholder="merged_dataset"
                      disabled={mergeRunning}
                      className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 focus:border-green-500"
                    />
                  </div>
                </div>

                {/* Merge button */}
                <Button
                  className="w-full bg-green-500 hover:bg-green-600 text-white disabled:opacity-50"
                  disabled={selected.size < 2 || !outputName.trim() || mergeRunning}
                  onClick={handleMerge}
                >
                  {mergeRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Merging…
                    </>
                  ) : (
                    <>
                      <Merge className="w-4 h-4 mr-2" />
                      Merge Datasets
                    </>
                  )}
                </Button>

                {/* Status / log */}
                {mergeStatus && (
                  <div className="space-y-2">
                    <div className={`flex items-center gap-2 text-sm ${
                      mergeStatus.progress === "error" ? "text-red-400" :
                      mergeStatus.success ? "text-green-400" : "text-gray-300"
                    }`}>
                      {mergeStatus.running && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
                      {mergeStatus.success === true && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                      <span>{mergeStatus.message}</span>
                    </div>
                    <StepLog steps={mergeStatus.steps} />
                  </div>
                )}
              </div>

              {/* Hint */}
              <p className="text-xs text-gray-600 leading-relaxed">
                Datasets must have compatible features (same observations and action spaces).
                The merged result is saved locally and can be used for training immediately.
              </p>
            </div>
          </div>
        )}

        {/* ── DELETE EPISODES TAB ──────────────────────────────────────── */}
        {tab === "delete" && (
          <div className="max-w-xl space-y-5">
            <p className="text-sm text-gray-400">
              Remove bad or incomplete episodes. The result is saved as a
              new dataset — the original is left untouched.
            </p>

            {/* Dataset picker */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Source dataset</Label>
              <select
                value={deleteTarget}
                onChange={(e) => setDeleteTarget(e.target.value)}
                className="w-full rounded-md border border-gray-600 bg-gray-800 text-white px-3 py-2 text-sm focus:outline-none focus:border-green-500"
              >
                <option value="">— select a dataset —</option>
                {datasets.map((ds) => (
                  <option key={ds.repo_id} value={ds.repo_id}>
                    {ds.repo_id}
                    {ds.num_episodes !== null ? ` (${ds.num_episodes} episodes)` : ""}
                  </option>
                ))}
              </select>
              {targetDataset && (
                <p className="text-xs text-gray-500">
                  {targetDataset.num_episodes} episodes · {targetDataset.num_frames} frames
                  {targetDataset.robot_type ? ` · ${targetDataset.robot_type}` : ""}
                </p>
              )}
            </div>

            {/* Episode indices */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">Episodes to delete</Label>
              <Input
                value={deleteIndices}
                onChange={(e) => setDeleteIndices(e.target.value)}
                placeholder="0, 3, 7   (comma or space separated)"
                className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 focus:border-green-500"
              />
              <p className="text-xs text-gray-600">
                Episode indices start at 0. Remaining episodes are re-indexed automatically.
              </p>
            </div>

            {/* Output name (optional) */}
            <div className="space-y-1.5">
              <Label className="text-gray-300 text-sm">
                Output dataset name <span className="text-gray-500">(optional)</span>
              </Label>
              <div className="flex items-center gap-2">
                {auth.status === "authenticated" && (
                  <span className="text-gray-500 text-sm flex-shrink-0">{auth.username}/</span>
                )}
                <Input
                  value={deleteOutputName}
                  onChange={(e) => setDeleteOutputName(e.target.value)}
                  placeholder={deleteTarget ? `${deleteTarget.split("/").pop()}_cleaned` : "my_dataset_cleaned"}
                  className="bg-gray-800 border-gray-600 text-white placeholder:text-gray-500 focus:border-green-500"
                />
              </div>
              <p className="text-xs text-gray-600">Defaults to &lt;source_name&gt;_cleaned if left empty.</p>
            </div>

            <Button
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              disabled={!deleteTarget || !deleteIndices.trim() || deleting}
              onClick={handleDelete}
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Episodes
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EditDataset;
