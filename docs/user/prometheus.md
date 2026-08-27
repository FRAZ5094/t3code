# Prometheus metrics

T3 Code can expose an opt-in Prometheus endpoint on the same HTTP port as the server. Enable it
before starting T3 Code:

```bash
export T3CODE_PROMETHEUS_METRICS_ENABLED=true
npx t3
```

Prometheus can then scrape `http://<t3-host>:<t3-port>/metrics`. The endpoint is unauthenticated,
so only enable it when the T3 server is reachable through a trusted interface or private network.

The endpoint includes request, orchestration, provider, Git, and terminal metrics, along with
current gauges for active provider sessions and turns, referenced worktrees, and the CPU consumed
by the T3 process tree. CPU is reported in logical cores: `1.0` means one fully occupied core.

Use `t3_agents_running` for the total number of agents currently doing work and
`t3_provider_turns_active` for the provider breakdown.

Machine temperature is deliberately not collected by T3 Code. Use a host exporter such as
node_exporter or a platform-specific exporter and correlate it with `t3_provider_turns_active` and
`t3_process_cpu_cores` in Prometheus.
