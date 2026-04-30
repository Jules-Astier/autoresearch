---
name: model-diagram-tikz
description: Create publication-quality ML model architecture diagrams using TikZ/LaTeX, including rendered PDF/PNG outputs. Use when the user asks for academic paper standard model diagrams, neural network architecture figures, transformer/attention diagrams, CNN/U-Net diagrams, or a reproducible TikZ source plus compiled image.
---

# Model Diagram TikZ

Create paper-quality ML architecture figures as reproducible TikZ/LaTeX source and compiled artifacts.

## Core Workflow

1. Identify the figure type before writing code.
2. Choose the visual grammar from the table below.
3. Write a standalone `.tex` file using TikZ/LaTeX.
4. Compile to vector PDF.
5. Export a high-resolution PNG preview.
6. Inspect the rendered image before final response.
7. Return paths to `.tex`, `.pdf`, and high-res `.png`.

Never stop at source code only unless the user explicitly asks for source only.

For Autoresearch runs, commit only the `.tex` source. The runner compiles the PDF as a temporary intermediate and persists only the PNG artifact.

## Diagram Grammar

Use the smallest grammar that explains the architecture clearly:

- **Transformer / sequence model:** 2D blocks with residual arrows, repeated-layer braces, embedding/projection nodes, and clear encoder/decoder or decoder-only boundaries.
- **Attention mechanism:** tensor-flow diagram with Q/K/V, matrix products, softmax, value aggregation, and visual hints for tensor dimensions.
- **CNN / U-Net / vision model:** 3D tensor blocks or stacked planes, with spatial resolution/channel annotations and skip connections.
- **Research experiment pipeline:** restrained 2D block system showing data, model, controls, simulation/evaluation, and artifacts.
- **Generic MLP / autoencoder:** neuron-layer diagram only when the layer topology itself matters; otherwise use abstract blocks.

If unsure, prefer a clean 2D block architecture. Do not use Mermaid for paper figures.

## Style Rules

Use `standalone` document class for tight cropping.
Use vector-friendly shapes, simple color fills, and consistent typography.
Keep labels short; move details to annotations or caption text.
Encode repeated structures with `N\times`, braces, or grouped panels instead of drawing every repeated layer.
Show the important data paths first, then auxiliary paths with lighter/dashed arrows.
Avoid decorative shadows, gradients, and unnecessary 3D effects.
Use color to encode semantics: data/tensors, learned modules, operations, losses/evaluation, constraints.
Prefer named TikZ styles and coordinates over one-off formatting.
Ensure the figure is legible when scaled to single-column and double-column paper widths.

## Compilation

Use the available TeX binary path if the shell cannot find LaTeX:

```bash
PATH="/Library/TeX/texbin:$PATH" pdflatex -interaction=nonstopmode -halt-on-error figure.tex
```

Export PNG from the PDF. Prefer `pdftoppm` if available:

```bash
pdftoppm -png -r 300 figure.pdf figure
```

On macOS without `pdftoppm`, use Quick Look for a high-resolution preview:

```bash
qlmanage -t -s 2400 -o . figure.pdf
```

Remove transient `.aux` and `.log` files after successful compilation unless the user asks to debug LaTeX.

## Validation

Before final response:

- Open or inspect the rendered PNG/PDF.
- Check no labels overlap.
- Check arrows enter the intended nodes.
- Check the figure is not cropped incorrectly.
- Check generated image dimensions are high enough for review.
- If compilation fails due to missing packages, simplify the TikZ dependency set before asking the user to install more packages.

## References

Read [references/examples.md](references/examples.md) when you need visual inspiration or source links for known high-quality examples.

Use these families:

- NNTikZ for transformer, RNN, GRU, and attention block diagrams.
- Janosh/TikZ.net for polished mechanism and tensor-flow diagrams.
- PlotNeuralNet for CNN/U-Net/vision architecture diagrams with 3D tensor blocks.

## Final Response

Give the user concise file links:

- source `.tex`
- vector `.pdf`
- high-resolution `.png`

Mention any compile/export limitation only if relevant.
