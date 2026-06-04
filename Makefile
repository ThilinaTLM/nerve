PNPM ?= pnpm

.DEFAULT_GOAL := help

.PHONY: help dev dev-deps daemon web desktop desktop-fast desktop-build desktop-check

help:
	@printf "Nerve shortcuts:\n"
	@printf "  make dev            Build internal deps, then start daemon and web UI dev servers\n"
	@printf "  make daemon         Build internal deps, then start the orchestrator daemon in dev mode\n"
	@printf "  make web            Build internal deps, then start the Svelte web UI dev server\n"
	@printf "  make desktop        Build web/orchestrator/desktop and launch Electron\n"
	@printf "  make desktop-fast   Launch Electron using existing build output\n"
	@printf "  make desktop-build  Build desktop dependencies and Electron main process\n"
	@printf "  make desktop-check  Type-check the desktop package\n"

dev: dev-deps
	$(PNPM) --parallel --stream --filter @nerve/orchestrator --filter @nerve/web dev

dev-deps:
	$(PNPM) --filter @nerve/shared --filter @nerve/agent --filter @nerve/tools build

daemon: dev-deps
	$(PNPM) --filter @nerve/orchestrator dev

web: dev-deps
	$(PNPM) --filter @nerve/web dev

desktop:
	$(PNPM) desktop

desktop-fast:
	$(PNPM) --filter @nerve/desktop start

desktop-build:
	$(PNPM) --filter @nerve/web build
	$(PNPM) --filter @nerve/orchestrator build
	$(PNPM) --filter @nerve/desktop build

desktop-check:
	$(PNPM) --filter @nerve/desktop check
