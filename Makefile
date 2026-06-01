PNPM ?= pnpm

.DEFAULT_GOAL := help

.PHONY: help desktop desktop-fast desktop-build desktop-check

help:
	@printf "Nerve shortcuts:\n"
	@printf "  make desktop        Build web/orchestrator/desktop and launch Electron\n"
	@printf "  make desktop-fast   Launch Electron using existing build output\n"
	@printf "  make desktop-build  Build desktop dependencies and Electron main process\n"
	@printf "  make desktop-check  Type-check the desktop package\n"

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
