PNPM ?= pnpm
NODE ?= node

.DEFAULT_GOAL := help

.PHONY: help dev dev-deps cli daemon serve web desktop desktop-fast desktop-build desktop-check install uninstall

help:
	@$(NODE) scripts/make-help.mjs

dev: dev-deps
	$(PNPM) --parallel --stream --filter @nerve/orchestrator --filter @nerve/web dev

dev-deps:
	$(PNPM) --filter @nerve/shared --filter @nerve/agent --filter @nerve/tools build

cli: dev-deps
	$(PNPM) --filter @nerve/cli dev --

daemon: dev-deps
	$(PNPM) --filter @nerve/orchestrator dev

serve: dev-deps
	$(PNPM) --filter @nerve/cli dev -- serve --open

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

install:
	$(PNPM) --filter @nerve/desktop icons
	$(NODE) scripts/install-desktop.mjs install --pnpm "$(PNPM)"

uninstall:
	$(NODE) scripts/install-desktop.mjs uninstall --pnpm "$(PNPM)"
