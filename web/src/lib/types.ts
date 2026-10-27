import type { Stage, TimerStatus } from '@shared/timer.ts';

export type Role = 'admin' | 'teacher' | 'viewer';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface LiveTimer {
  sessionId: number;
  entryId: number;
  status: TimerStatus;
  stages: Stage[];
  elapsedMs: number;
  speed: number;
  revision: number;
  startedAt: string;
  /** Contagem regressiva restante (ms) no momento do envio; 0 = o tempo já corre. */
  countdownMs: number;
}

export interface LiveState {
  serverNow: number;
  day: { id: number; label: string; date: string; room: string | null };
  event: {
    id: number;
    name: string;
    institution: string | null;
    warnPct: number;
    dangerPct: number;
    /** Alerta de troca de etapa: segundos antes de entrar numa etapa destacada (0 = desligado). */
    stageAlertBeforeSeconds: number;
    /** Segundos de destaque depois de entrar na etapa (0 = desligado). */
    stageAlertAfterSeconds: number;
    showStudentNames: boolean;
  };
  current: null | {
    entryId: number;
    groupId: number;
    code: string;
    className: string;
    title: string;
    position: number;
    color: string;
    students: string[] | null;
    status: EntryStatus;
    started: boolean;
  };
  next: null | { entryId: number; code: string; className: string; title: string };
  plannedStages: Stage[] | null;
  timer: LiveTimer | null;
}

export type EntryStatus = 'waiting' | 'running' | 'started' | 'awaiting_closure' | 'finalized';

export interface ScheduleRow {
  entryId: number;
  position: number;
  groupId: number;
  code: string;
  className: string;
  title: string;
  /** Cor de identificação do grupo. */
  color: string;
  timeProfileId: number | null;
  effectiveProfileId: number | null;
  durationSeconds: number;
  predictedStart: string | null;
  predictedEnd: string | null;
  overflow: boolean;
  movedAfterBreak: string | null;
  startedAt: string | null;
  endedAt: string | null;
  started: boolean;
  timerStatus: string | null;
  status: EntryStatus;
  statusLabel: string;
  isCurrent: boolean;
  expectedEvaluators: number;
  submittedEvaluators: number;
  excusedEvaluators: number;
  closureVersion: number | null;
}

export interface DayInfo {
  id: number;
  eventId: number;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string | null;
  gapMinutes: number;
  defaultProfileId: number | null;
  primaryUserId: number | null;
  currentEntryId: number | null;
  breaks: Array<{ id: number; label: string; start: string; end: string }>;
}

export interface DaySchedule {
  day: DayInfo;
  entries: ScheduleRow[];
  warnings: string[];
  predictedEnd: string | null;
}

export interface Criterion {
  id: number;
  position: number;
  title: string;
  description: string | null;
  weight: number;
  required: boolean;
  commentEnabled: boolean;
  commentRequired: boolean;
}

export interface RubricDef {
  versionId: number;
  templateId: number;
  templateName: string;
  title: string;
  version: number;
  instructions: string | null;
  scale: { min: number; max: number; step: number; normalization: 'linear' | null };
  generalCommentRequired: boolean;
  evaluatorRole: string | null;
  dimension: string | null;
  dimensionShort: string | null;
  feedbackLabel: string | null;
  scaleLabels: Array<{ value: number; label: string }>;
  sortOrder: number;
  criteria: Criterion[];
}

export interface VoteQuestion {
  id: number;
  title: string;
  prompt: string;
  required: boolean;
  allowAbstain: boolean;
  rule: 'simple_majority' | 'quorum' | 'counts_only';
  quorumMin: number | null;
  options: Array<{ id: number; label: string; isAbstain: boolean }>;
}

export interface EvaluationForm {
  evaluation: {
    id: number;
    entryId: number;
    groupId: number;
    status: 'draft' | 'submitted';
    revision: number;
    generalComment: string;
    updatedAt: string;
    submittedAt: string | null;
    editable: boolean;
    lockedReason: string | null;
    closed: boolean;
    editPolicy: 'locked' | 'until_closure';
    aggregation: 'mean' | 'sum';
  };
  group: { id: number; code: string; className: string; title: string; description: string | null; advisor: string | null; students: string[] };
  rubric: RubricDef;
  scores: Array<{ criterionId: number; score: number | null; comment: string }>;
  questions: VoteQuestion[];
  votes: Array<{ questionId: number; optionId: number }>;
}

export interface DayAccess {
  dayId: number;
  eventId: number;
  isAdmin: boolean;
  isPrimary: boolean;
  isAssigned: boolean;
  isViewer: boolean;
  canControl: boolean;
}

export interface Workspace {
  day: DayInfo;
  event: { id: number; name: string; editAfterSubmit: string; warnPct: number; dangerPct: number };
  access: DayAccess;
  primaryName: string | null;
  entries: Array<ScheduleRow & { assignedToMe: boolean; myEvaluationId: number | null; myEvaluationStatus: string | null }>;
  warnings: string[];
  predictedEnd: string | null;
  current:
    | null
    | (ScheduleRow & {
        description: string | null;
        advisor: string | null;
        advisors: string[];
        hasMaterials: boolean;
        students: string[];
        myEvaluationId: number | null;
        myEvaluationStatus: string | null;
      });
  progress: Array<{ userId: number; name: string; status: string }> | null;
  /** Telão: este dia está em exibição, ou outro dia ocupa o telão. */
  display: { active: boolean; other: { dayId: number; label: string; eventName: string } | null };
}

export interface MyDay {
  id: number;
  label: string;
  date: string;
  startTime: string;
  endTime: string;
  room: string | null;
  eventName: string;
  isPrimary: boolean;
  isAssigned: boolean;
  canControl: boolean;
}

/** Arquivo enviado no cadastro do grupo (slides ou artigo). */
export interface GroupFile {
  kind: 'slides' | 'article';
  name: string;
  mime: string;
  size: number;
  uploadedAt: string;
  url: string;
}

/** Resumo, orientadores e materiais do projeto (área do professor). */
export interface ProjectInfo {
  id: number;
  code: string;
  className: string;
  title: string;
  summary: string | null;
  advisors: string[];
  students: string[];
  projectUrl: string | null;
  pdfUrl: string | null;
  slidesUrl: string | null;
  githubUrl: string | null;
  slidesFile: GroupFile | null;
  articleFile: GroupFile | null;
  color: string;
  position: number | null;
  rubricTypeName: string | null;
}
