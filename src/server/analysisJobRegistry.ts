import crypto from "node:crypto";

export type AnalysisJob = {
  key: string;
  generation: string;
  token: string;
  controller: AbortController;
};

export class AnalysisJobRegistry {
  private readonly jobs = new Map<string, AnalysisJob>();

  constructor(private readonly maxConcurrentJobs = 3) {}

  begin(key: string, generation: string): AnalysisJob {
    if (!this.jobs.has(key) && this.jobs.size >= this.maxConcurrentJobs) {
      throw new Error(
        `Analysis concurrency limit reached (${this.maxConcurrentJobs})`,
      );
    }
    this.jobs.get(key)?.controller.abort();
    const job = {
      key,
      generation,
      token: crypto.randomUUID(),
      controller: new AbortController(),
    };
    this.jobs.set(key, job);
    return job;
  }

  isCurrent(job: AnalysisJob) {
    return (
      !job.controller.signal.aborted &&
      this.jobs.get(job.key)?.token === job.token
    );
  }

  cancel(job: AnalysisJob) {
    if (this.jobs.get(job.key)?.token === job.token) {
      job.controller.abort();
    }
  }

  finish(job: AnalysisJob) {
    if (this.jobs.get(job.key)?.token === job.token) {
      this.jobs.delete(job.key);
    }
  }
}
