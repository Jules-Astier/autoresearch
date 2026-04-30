# High-Quality TikZ Model Diagram References

Use this file only when you need examples or source links.

## NNTikZ

Good for clean academic 2D ML architecture diagrams.

- Repo: https://github.com/fraserlove/nntikz
- Transformer image: https://raw.githubusercontent.com/fraserlove/nntikz/main/assets/transformer.png
- Transformer code: https://raw.githubusercontent.com/fraserlove/nntikz/main/tikz/transformer.tex
- Multi-head attention image: https://raw.githubusercontent.com/fraserlove/nntikz/main/assets/multihead_attention.png
- Multi-head attention code: https://raw.githubusercontent.com/fraserlove/nntikz/main/tikz/multihead_attention.tex
- Attention image: https://raw.githubusercontent.com/fraserlove/nntikz/main/assets/attention.png
- Attention code: https://raw.githubusercontent.com/fraserlove/nntikz/main/tikz/attention.tex
- GRU image: https://raw.githubusercontent.com/fraserlove/nntikz/main/assets/gru.png
- GRU code: https://raw.githubusercontent.com/fraserlove/nntikz/main/tikz/gru.tex
- Neural network image: https://raw.githubusercontent.com/fraserlove/nntikz/main/assets/neural_network.png
- Neural network code: https://raw.githubusercontent.com/fraserlove/nntikz/main/tikz/neural_network.tex

Use patterns from NNTikZ:

- `standalone` class.
- Named styles for `block`, `layer`, `input`, and `arrow`.
- `fit` and `backgrounds` libraries for encoder/decoder boundaries.
- `N\times` labels for repeated modules.
- Residual arrows drawn as routed paths around sublayers.

## Janosh Scientific Diagrams / TikZ.net

Good for mechanism diagrams, tensor math, and polished educational figures.

- Gallery: https://diagrams.janosh.dev/
- Single-head attention page: https://diagrams.janosh.dev/single-head-attention
- Single-head attention image: https://raw.githubusercontent.com/janosh/tikz/main/assets/single-head-attention/single-head-attention.png
- Single-head attention code: https://raw.githubusercontent.com/janosh/tikz/main/assets/single-head-attention/single-head-attention.tex
- Self-attention page: https://diagrams.janosh.dev/self-attention
- Self-attention image: https://raw.githubusercontent.com/janosh/tikz/main/assets/self-attention/self-attention.png
- Self-attention code: https://raw.githubusercontent.com/janosh/tikz/main/assets/self-attention/self-attention.tex
- TikZ.net self-attention page with inline code: https://tikz.net/self-attention/
- Autoencoder code: https://raw.githubusercontent.com/janosh/tikz/main/assets/autoencoder/autoencoder.tex

Use patterns from Janosh/TikZ.net:

- Keep the equation close to the diagram when the mechanism is mathematical.
- Use colored borders to encode tensor dimensions.
- Use opacity to de-emphasize non-focal paths.
- Prefer compact, semantic shapes over broad decorative panels.

## PlotNeuralNet

Good for CNN/U-Net/vision architectures where tensor shape and channel depth are central.

- Repo: https://github.com/HarisIqbal88/PlotNeuralNet
- README examples: https://github.com/HarisIqbal88/PlotNeuralNet#examples
- FCN-8 rendered PDF: https://raw.githubusercontent.com/HarisIqbal88/PlotNeuralNet/master/examples/fcn8s/fcn8.pdf
- FCN-8 source: https://raw.githubusercontent.com/HarisIqbal88/PlotNeuralNet/master/examples/fcn8s/fcn8.tex
- U-Net rendered PDF: https://raw.githubusercontent.com/HarisIqbal88/PlotNeuralNet/master/examples/Unet/Unet.pdf
- U-Net source: https://raw.githubusercontent.com/HarisIqbal88/PlotNeuralNet/master/examples/Unet/Unet.tex
- U-Net Python generator: https://raw.githubusercontent.com/HarisIqbal88/PlotNeuralNet/master/pyexamples/unet.py

Use PlotNeuralNet when the diagram needs:

- 3D tensor blocks.
- Spatial resolution and channel count annotations.
- U-shaped skip connections.
- Image input/output panels.

Avoid PlotNeuralNet for transformer, trading, or experiment-pipeline figures unless the model is actually vision-like.
