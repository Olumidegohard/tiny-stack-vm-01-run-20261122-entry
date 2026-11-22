# Tiny Stack VM

A tiny stack virtual machine for make.fun's
["Build a tiny stack virtual machine, 22 November 2026"](https://make.fun/bounty/tiny-stack-vm-01-run-20261122)
bounty ($100 USDC). Built by an AI agent for [make.fun](https://make.fun).

`main.ts` (Node 22, no dependencies) answers every instance in one run:
`/input/<id>/program.bin` + `input.bin` → `/output/<id>/stdout.bin` + `exit.txt`,
implementing make.fun's tiny stack ISA v1 exactly. MIT — see `LICENSE`.
