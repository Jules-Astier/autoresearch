export type MetricDirection = "minimize" | "maximize";

export type MetricContract = {
  primary_metric: string;
  metric_directions: Record<string, MetricDirection | string>;
};

export type ObjectiveState = {
  primary_metric: string;
  direction: MetricDirection | string;
  best_experiment_id?: string | null;
};

export type SessionState = {
  session_id?: string;
  status?: string;
  heartbeat_at_utc?: string;
  checkout?: string;
  pid?: number | null;
  current_phase?: string;
  completed_experiments?: number;
  max_experiments?: number;
  objective?: ObjectiveState;
  best_metrics?: Record<string, number>;
  metric_directions?: Record<string, MetricDirection | string>;
};

export type Experiment = {
  run_id: string;
  created_at: string;
  status: string;
  experiment_id: string;
  hypothesis: string;
  metrics: Record<string, number>;
  promoted: boolean;
  comment: string;
  raw: Record<string, string>;
};

export type DagNode = {
  run_id?: string;
  experiment_id?: string;
  hash?: string;
  parent_hash?: string;
  candidate_hash?: string;
  status?: string;
  promoted?: boolean;
  is_master?: boolean;
  hypothesis?: string;
  metrics?: Record<string, number>;
  [key: string]: unknown;
};

export type SessionSnapshot = {
  session_id: string;
  title: string;
  session_root: string;
  checkout: string;
  status: string;
  completed_experiments: number;
  promoted_count: number;
  state: SessionState;
  metric_contract: MetricContract;
  best_metrics: Record<string, number>;
  experiments: Experiment[];
  dag: DagNode[];
  logs: {
    stdout_tail: string;
    stderr_tail: string;
  };
};

export type SessionsResponse = {
  runtime_root: string;
  sessions: SessionSnapshot[];
};
