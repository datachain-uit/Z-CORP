#!/usr/bin/env python3
"""Draw Figure 6: constraint growth across Merkle tree depths.

Two panels with separate vertical scales, because Groth16 R1CS constraints and
PLONK expanded gates differ by roughly an order of magnitude; on a shared axis
the Groth16 trend is flattened against the baseline.

Usage:
    python3 plot_constraints.py <constraints.csv> <output.pdf>
"""
import csv
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

GROTH16 = "#1f77b4"
PLONK = "#ff7f0e"


def main(csv_path, out_path):
    with open(csv_path) as fh:
        rows = list(csv.DictReader(fh))
    depths = [int(r["Depth"]) for r in rows]
    series = [
        ([int(r["Groth16"]) for r in rows], GROTH16, "Groth16 (R1CS constraints)", "#Constraints"),
        ([int(r["PLONK"]) for r in rows], PLONK, "PLONK (expanded gates)", "#Gates"),
    ]
    x = np.arange(len(depths))

    fig, axes = plt.subplots(1, 2, figsize=(16, 6.2))
    for ax, (vals, colour, title, ylabel) in zip(axes, series):
        bars = ax.bar(x, vals, 0.62, color=colour)
        for b in bars:
            ax.annotate(f"{int(b.get_height()):,}",
                        xy=(b.get_x() + b.get_width() / 2, b.get_height()),
                        xytext=(0, 4), textcoords="offset points",
                        ha="center", va="bottom", fontsize=11.5, fontweight="bold")
        ax.set_title(title, fontsize=17, pad=10)
        ax.set_xlabel("Merkle tree depth", fontsize=15, labelpad=8)
        ax.set_ylabel(ylabel, fontsize=15, labelpad=8)
        ax.set_xticks(x)
        ax.set_xticklabels(depths, fontsize=13)
        ax.tick_params(axis="y", labelsize=13)
        ax.set_ylim(0, max(vals) * 1.12)
        ax.grid(axis="y", color="0.85", linewidth=0.8)
        ax.set_axisbelow(True)

    fig.suptitle("Constraint comparison across Merkle tree depths", fontsize=21, y=0.985)
    fig.tight_layout(rect=[0, 0, 1, 0.955])
    fig.savefig(out_path)
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
