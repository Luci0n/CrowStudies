# AI-assisted RE tooling: what runs in this cloud container

Tested 2026-10-03 in the Claude Code cloud container (Linux x86-64, 4 cores, 15 GB RAM, no GUI, no Docker
daemon, outbound HTTPS through a proxy). "Works" means it was installed and run on a real input here, not
just found on the web.

| Tool | What it is | Status here | Evidence / notes |
|---|---|---|---|
| **Ghidra 12.1** (headless) | NSA's disassembler/decompiler | **Works** | `analyzeHeadless` + PyGhidra decompiled a gcc-built test binary (`score = param_1 + score;`). Ghidra ≥ 12 is required by current `pyghidra`; 11.4.2 is rejected. Java scripts in a scratch dir hit an OSGi loader error, so use Python. |
| **pyghidra-mcp 0.2.7** | Headless Ghidra MCP server | **Works** | Over streamable-HTTP it exposed 20 tools (`decompile_function`, `list_xrefs`, `rename_variable`, `set_function_prototype`, `gen_callgraph`, …), and `decompile_function("add")` returned the same C. This is the one usable Ghidra↔Claude bridge without a GUI. Install it in a venv (pip conflicts with Debian's PyYAML). |
| GhidraMCP (LaurieWired) / 13bm GhidraMCP | GUI plugin + Python bridge | Not usable | Needs the Ghidra GUI running a plugin (Tools → Start MCP Server). There is no display here. |
| ida-pro-mcp (mrexodia), ida-mcp 2.0 | IDA Pro MCP servers | **Not usable** | Needs a licensed IDA Pro (ida-mcp 2.0 is headless but still needs idalib). Fine on the user's own machine. |
| **N64Recomp** (+ RSPRecomp) | N64 MIPS → C static recompiler | **Builds** | `cmake && ninja` built `N64Recomp` and `RSPRecomp`. Needs an N64 ELF/ROM the user owns plus a symbol TOML. |
| XenonRecomp / ReXGlue | Xbox 360 PPC → C++ | Not tried | They should build (clang and cmake are present), but they need a 360 XEX the user owns and Xenia-derived GPU code. Without game files they can't be tested here. |
| **m2c** | MIPS/PPC asm → C (decomp starter) | **Works, picky input** | Runs. It wants spimdisasm/IDO-style asm (named regs, `glabel`). Raw `mips-linux-gnu-gcc -S` output needs register renaming and still trips on immediate-form `slt`. Real decomp projects feed it spimdisasm output. |
| **decomp-permuter** | Random/AI-guided source permutation to match bytes | **Runs** | `permuter.py --help` OK. Useful only with a target compiler (IDO, old GCC) and a matching setup. |
| **objdiff-cli 3.8.2** | Object-level diff for matching decomp | **Works** | Release binary downloads and runs. |
| capstone, unicorn, lief, r2pipe | Disasm / CPU emulation / binary parsing libs | **Works** | `pip install` OK. angr failed to build (`mulpyplexer`, `arpy` wheels). radare2 is not installed (only the r2pipe binding). |
| **PyBoy** | Scriptable Game Boy emulator | **Works** | `pip install pyboy`, usable as a headless oracle for differential tests. |
| Toolchains | `gcc`, `clang`, `mips-linux-gnu-gcc`, `cc65`/`ca65` (NES/6502), `sdcc` (GB/Z80) | **Works** | Installed via apt. `rgbds` is not in apt (would need building from source). |

## Network quirks
- `git clone` and GitHub **release downloads** work. The **GitHub REST API** is blocked for repos not attached
  to the session, so `releases/latest` JSON fails and asset names have to be found another way (Ghidra's
  zip name was found by probing dates after the tag commit).
- pypi, crates.io and npm are reachable directly. apt works.

## How a Claude agent uses these here
`pyghidra-mcp -t streamable-http` runs as a background server, and the agent calls its tools through the
`mcp` Python client. That gives the same decompile / xref /
rename loop as the GUI plugins, without a display.
