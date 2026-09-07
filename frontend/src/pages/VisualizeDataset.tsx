import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DatasetMeta {
  repo_id: string;
  num_episodes: number | null;
  num_frames: number | null;
  fps: number | null;
  robot_type: string | null;
  tasks: string[];
  loadable: boolean;
}

interface EpisodeInfo {
  episode_index: number;
  length: number;
  task: string;
}

interface CameraVideoInfo {
  key: string;
  rel_path: string;
  from_timestamp: number;
  to_timestamp: number;
}

interface EpisodeSeries {
  key: string;
  feature: string;
  label: string;
  values: number[];
}

// Distinct colors reused across chart lines within a feature group.
const LINE_COLORS = [
  "#60a5fa",
  "#f87171",
  "#34d399",
  "#fbbf24",
  "#c084fc",
  "#22d3ee",
  "#fb923c",
  "#a3e635",
];

const shortId = (r: string) => (r.includes("/") ? r.split("/")[1] : r);

// ─── Main Page ────────────────────────────────────────────────────────────────

const VisualizeDataset: React.FC = () => {
  const navigate = useNavigate();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();

  // ── Dataset + episode selection ──
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);

  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);

  // ── Episode media / data ──
  const [cameras, setCameras] = useState<CameraVideoInfo[]>([]);
  const [series, setSeries] = useState<EpisodeSeries[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [episodeLoading, setEpisodeLoading] = useState(false);

  // ── Playback sync ──
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const [cursorTime, setCursorTime] = useState(0); // seconds since episode start
  const rafRef = useRef<number | null>(null);

  const selectedMeta = useMemo(
    () => datasets.find((d) => d.repo_id === selectedDataset) ?? null,
    [datasets, selectedDataset]
  );

  // Load datasets on mount
  useEffect(() => {
    setDatasetsLoading(true);
    fetchWithHeaders(`${baseUrl}/edit/datasets`)
      .then((r) => r.json())
      .then((data: DatasetMeta[]) =>
        setDatasets(data.filter((d) => d.loadable && (d.num_episodes ?? 0) > 0))
      )
      .catch((e) => console.error("Failed to load datasets:", e))
      .finally(() => setDatasetsLoading(false));
  }, [baseUrl, fetchWithHeaders]);

  // Load episode list when a dataset is selected
  const loadEpisodes = useCallback(
    (repoId: string) => {
      setEpisodesLoading(true);
      setEpisodes([]);
      setSelectedEpisode(null);
      fetchWithHeaders(
        `${baseUrl}/dataset-episodes?repo_id=${encodeURIComponent(repoId)}`
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            setEpisodes(data.episodes ?? []);
            if ((data.episodes ?? []).length > 0) {
              setSelectedEpisode(data.episodes[0].episode_index);
            }
          } else {
            toast({
              title: "Could not load episodes",
              description: data.message,
              variant: "destructive",
            });
          }
        })
        .catch((e) =>
          toast({ title: "Error", description: String(e), variant: "destructive" })
        )
        .finally(() => setEpisodesLoading(false));
    },
    [baseUrl, fetchWithHeaders, toast]
  );

  const handleSelectDataset = useCallback(
    (repoId: string) => {
      setSelectedDataset(repoId);
      loadEpisodes(repoId);
    },
    [loadEpisodes]
  );

  // Load video info + numeric series whenever the selected episode changes
  useEffect(() => {
    if (!selectedDataset || selectedEpisode === null) {
      setCameras([]);
      setSeries([]);
      setTimestamps([]);
      return;
    }
    setEpisodeLoading(true);
    setCursorTime(0);
    videoRefs.current.clear();

    Promise.all([
      fetchWithHeaders(
        `${baseUrl}/dataset-episode-video-info?repo_id=${encodeURIComponent(selectedDataset)}&episode_index=${selectedEpisode}`
      ).then((r) => r.json()),
      fetchWithHeaders(
        `${baseUrl}/dataset-episode-data?repo_id=${encodeURIComponent(selectedDataset)}&episode_index=${selectedEpisode}`
      ).then((r) => r.json()),
    ])
      .then(([videoData, seriesData]) => {
        if (videoData.success) setCameras(videoData.cameras ?? []);
        else {
          setCameras([]);
          toast({
            title: "Could not load video",
            description: videoData.message,
            variant: "destructive",
          });
        }
        if (seriesData.success) {
          setSeries(seriesData.series ?? []);
          setTimestamps(seriesData.timestamps ?? []);
        } else {
          setSeries([]);
          setTimestamps([]);
          toast({
            title: "Could not load episode data",
            description: seriesData.message,
            variant: "destructive",
          });
        }
      })
      .catch((e) =>
        toast({ title: "Error", description: String(e), variant: "destructive" })
      )
      .finally(() => setEpisodeLoading(false));
  }, [baseUrl, fetchWithHeaders, selectedDataset, selectedEpisode, toast]);

  const masterKey = cameras[0]?.key ?? null;

  // Register a video element ref and, for follower cameras, keep it in sync
  // with the master camera's playback position.
  const registerVideo = useCallback(
    (key: string) => (el: HTMLVideoElement | null) => {
      if (el) videoRefs.current.set(key, el);
      else videoRefs.current.delete(key);
    },
    []
  );

  const seekAllTo = useCallback(
    (relTime: number) => {
      cameras.forEach((cam) => {
        const el = videoRefs.current.get(cam.key);
        if (!el) return;
        const target = cam.from_timestamp + relTime;
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
      });
      setCursorTime(relTime);
    },
    [cameras]
  );

  // Drive follower videos + chart cursor from the master video's clock.
  useEffect(() => {
    if (!masterKey) return;

    const tick = () => {
      const master = videoRefs.current.get(masterKey);
      const masterCam = cameras.find((c) => c.key === masterKey);
      if (master && masterCam) {
        const relTime = master.currentTime - masterCam.from_timestamp;
        setCursorTime(relTime);
        cameras.forEach((cam) => {
          if (cam.key === masterKey) return;
          const el = videoRefs.current.get(cam.key);
          if (!el) return;
          const target = cam.from_timestamp + relTime;
          if (Math.abs(el.currentTime - target) > 0.15) el.currentTime = target;
          if (!master.paused && el.paused) el.play().catch(() => {});
          if (master.paused && !el.paused) el.pause();
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [masterKey, cameras]);

  // Group per-dimension series by feature (e.g. "observation.state", "action")
  // so each feature gets its own synced chart, mirroring the upstream
  // lerobot/visualize_dataset Space layout.
  const groupedSeries = useMemo(() => {
    const groups = new Map<string, EpisodeSeries[]>();
    for (const s of series) {
      const group = groups.get(s.feature) ?? [];
      group.push(s);
      groups.set(s.feature, group);
    }
    return Array.from(groups.entries());
  }, [series]);

  const episodeStart = timestamps[0] ?? 0;
  const chartData = useMemo(() => {
    return timestamps.map((t, i) => {
      const row: Record<string, number> = { t: t - episodeStart };
      for (const s of series) row[s.key] = s.values[i];
      return row;
    });
  }, [timestamps, series, episodeStart]);

  const maxRelTime = chartData.length > 0 ? chartData[chartData.length - 1].t : 0;

  const handleChartClick = (state: { activeLabel?: number }) => {
    if (state?.activeLabel == null) return;
    seekAllTo(state.activeLabel);
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="outline"
            onClick={() => navigate("/")}
            className="border-gray-500 hover:border-gray-200 text-gray-300 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Visualize Dataset</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Play back an episode with synced camera feeds and state/action
              charts — a local equivalent of the lerobot/visualize_dataset
              Space.
            </p>
          </div>
        </div>

        {/* Dataset + episode pickers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
            <h2 className="font-semibold text-white mb-3">Dataset</h2>
            {datasetsLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading datasets…
              </div>
            ) : datasets.length === 0 ? (
              <p className="text-gray-500 text-sm">No local datasets found.</p>
            ) : (
              <Select value={selectedDataset ?? ""} onValueChange={handleSelectDataset}>
                <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                  <SelectValue placeholder="Choose a dataset…" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  {datasets.map((ds) => (
                    <SelectItem
                      key={ds.repo_id}
                      value={ds.repo_id}
                      className="focus:bg-gray-700 focus:text-white"
                    >
                      <span className="font-medium">{shortId(ds.repo_id)}</span>
                      {ds.num_episodes !== null && (
                        <span className="ml-2 text-gray-400 text-xs">
                          ({ds.num_episodes} ep)
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedMeta && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedMeta.fps != null && (
                  <Badge variant="secondary">{selectedMeta.fps} fps</Badge>
                )}
                {selectedMeta.robot_type && (
                  <Badge variant="secondary">{selectedMeta.robot_type}</Badge>
                )}
                {selectedMeta.tasks.slice(0, 2).map((t) => (
                  <Badge key={t} variant="outline" className="border-gray-600 text-gray-300">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
            <h2 className="font-semibold text-white mb-3">Episode</h2>
            {!selectedDataset ? (
              <p className="text-gray-500 text-sm">Select a dataset first.</p>
            ) : episodesLoading ? (
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading episodes…
              </div>
            ) : episodes.length === 0 ? (
              <p className="text-gray-500 text-sm">No episodes found.</p>
            ) : (
              <Select
                value={selectedEpisode !== null ? String(selectedEpisode) : ""}
                onValueChange={(v) => setSelectedEpisode(Number(v))}
              >
                <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                  <SelectValue placeholder="Choose an episode…" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white max-h-72">
                  {episodes.map((ep) => (
                    <SelectItem
                      key={ep.episode_index}
                      value={String(ep.episode_index)}
                      className="focus:bg-gray-700 focus:text-white"
                    >
                      #{ep.episode_index} — {ep.length} frames
                      {ep.task ? ` — ${ep.task}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {episodeLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : selectedEpisode === null ? null : (
          <>
            {/* Camera grid */}
            {cameras.length === 0 ? (
              <div className="text-gray-500 text-sm mb-6">
                No video found for this episode.
              </div>
            ) : (
              <div
                className={`grid gap-3 mb-6 ${cameras.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
              >
                {cameras.map((cam) => {
                  const shortKey = cam.key.split(".").pop() ?? cam.key;
                  const isMaster = cam.key === masterKey;
                  const src = `${baseUrl}/dataset-video-file?repo_id=${encodeURIComponent(selectedDataset!)}&path=${encodeURIComponent(cam.rel_path)}#t=${cam.from_timestamp},${cam.to_timestamp}`;
                  return (
                    <div
                      key={cam.key}
                      className="rounded-lg overflow-hidden border border-gray-700 relative"
                    >
                      <video
                        ref={registerVideo(cam.key)}
                        src={src}
                        controls={isMaster}
                        muted={!isMaster}
                        playsInline
                        className="w-full bg-black"
                        style={{ maxHeight: "360px" }}
                        onLoadedMetadata={(e) => {
                          e.currentTarget.currentTime = cam.from_timestamp;
                        }}
                      />
                      <div className="absolute top-2 left-2 bg-black/60 text-xs px-2 py-0.5 rounded text-gray-200">
                        {shortKey}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Synced state/action charts */}
            {groupedSeries.length === 0 ? (
              <div className="text-gray-500 text-sm">
                No numeric features available to plot for this episode.
              </div>
            ) : (
              <div className="space-y-4">
                {groupedSeries.map(([feature, dims]) => (
                  <div
                    key={feature}
                    className="bg-gray-900 rounded-lg border border-gray-700 p-4"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <PlayCircle className="w-4 h-4 text-gray-400" />
                      <h3 className="font-semibold text-white">{feature}</h3>
                    </div>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={chartData}
                          margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                          onClick={handleChartClick}
                        >
                          <XAxis
                            dataKey="t"
                            type="number"
                            domain={[0, maxRelTime]}
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            stroke="#475569"
                            tickFormatter={(v: number) => `${v.toFixed(1)}s`}
                          />
                          <YAxis
                            tick={{ fill: "#94a3b8", fontSize: 11 }}
                            stroke="#475569"
                            width={48}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "#1e293b",
                              border: "1px solid #475569",
                              borderRadius: 8,
                            }}
                            labelStyle={{ color: "#cbd5e1" }}
                            labelFormatter={(v: number) => `${v.toFixed(2)}s`}
                          />
                          {dims.map((d, i) => (
                            <Line
                              key={d.key}
                              type="monotone"
                              dataKey={d.key}
                              name={d.label}
                              stroke={LINE_COLORS[i % LINE_COLORS.length]}
                              strokeWidth={1.5}
                              dot={false}
                              isAnimationActive={false}
                            />
                          ))}
                          <ReferenceLine x={cursorTime} stroke="#f87171" strokeWidth={2} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default VisualizeDataset;
