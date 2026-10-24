<p align="center">
  <img src="build/icon.png" width="96" alt="">
</p>

<h1 align="center">X.LLM</h1>

<p align="center">
  O x.com num app desktop para Windows, com <b>tradução automática para português</b> feita por IA
  <b>rodando no seu computador</b>: nada do que você lê é enviado para serviço de tradução nenhum.
</p>

> Projeto independente e não oficial. Não tem relação com a X Corp. "X" e "Twitter", e o logo do
> passarinho, são marcas da X Corp.

## O que ele faz

- **Tweets e bios em qualquer idioma viram português** no lugar do original, com a badge
  "Traduzido por X.LLM" e um "ver original" para alternar.
- **Texto dentro das fotos também** (versão GPU): OCR local encontra os blocos de texto, traduz e
  desenha a tradução por cima, com as cores amostradas da própria imagem.
- O que já está em português não é tocado. Links, @menções e #hashtags continuam clicáveis.
- Feed mais limpo: sem coluna da direita (trends, Premium), sem anúncios, sem botões flutuantes do
  Grok/Chat, sem autoplay de vídeo, "Show more" expandido sozinho, feed com 720 px.
- O login fica salvo entre aberturas (login pelo Google funciona dentro do app).

A tradução usa o [TranslateGemma 4B](https://huggingface.co/google/translategemma-4b-it) (Google)
num [llama.cpp](https://github.com/ggml-org/llama.cpp) local. O OCR usa o
[RapidOCR](https://github.com/RapidAI/RapidOCR) (modelos PP-OCRv6).

## Download: CPU ou GPU?

Baixe o instalador em [Releases](../../releases). São duas versões; escolha **uma**
(instalar uma substitui a outra):

| | **X.LLM GPU** (recomendada) | **X.LLM CPU** |
|---|---|---|
| Arquivo | `X.LLM-GPU-Setup-x.y.z.exe` | `X.LLM-CPU-Setup-x.y.z.exe` |
| Tradução roda na | placa de vídeo (Vulkan: NVIDIA, AMD ou Intel) | processador |
| Modelo | TranslateGemma 4B Q6_K (3,2 GB) | TranslateGemma 4B Q4_K_M (2,5 GB) |
| Texto nas fotos | ligado (OCR na GPU via DirectML) | desligado por padrão (dá pra ligar) |
| Velocidade de um tweet | quase instantâneo | alguns segundos |

Na dúvida: se você tem uma placa de vídeo dedicada com 6 GB ou mais, use a GPU.

## Requisitos mínimos

### Versão GPU

| | Mínimo | Recomendado |
|---|---|---|
| Sistema | Windows 10 64-bit | Windows 11 64-bit |
| Placa de vídeo | Vulkan 1.2 e DirectX 12, **6 GB de VRAM** (NVIDIA GTX 1060 6 GB, AMD RX 5600, Intel Arc A380) | 8 GB+ de VRAM (RTX 3060 ou melhor) |
| Memória RAM | 8 GB | 16 GB |
| Disco livre | 4 GB | 5 GB |
| Driver de vídeo | atualizado (o Vulkan vem no driver) | |
| Internet | para o X e para baixar o modelo uma vez | |

### Versão CPU

| | Mínimo | Recomendado |
|---|---|---|
| Sistema | Windows 10 64-bit | Windows 11 64-bit |
| Processador | x64 com 4 núcleos e AVX2 (Intel 4ª geração / AMD Ryzen) | 8+ núcleos |
| Memória RAM | 8 GB | 16 GB |
| Disco livre | 3,5 GB | 4 GB |
| Internet | para o X e para baixar o modelo uma vez | |

Placas integradas (Intel UHD/Iris, Radeon de APU) normalmente não têm memória suficiente: use a
versão CPU.

## Primeira execução

1. Rode o instalador. Ele não pede administrador e instala em `%LOCALAPPDATA%\Programs\X.LLM`.
   O Windows SmartScreen pode avisar que o app é de fonte desconhecida (o executável não é
   assinado): clique em **Mais informações → Executar assim mesmo**.
2. Abra o X.LLM e faça login no X normalmente.
3. Na primeira abertura o modelo de tradução é baixado do Hugging Face (2,5 a 3,2 GB). O progresso
   aparece no título da janela e na barra de tarefas; o X já pode ser usado enquanto isso. Se a
   conexão cair, o download continua de onde parou.

Os dados do app ficam em `%APPDATA%\X.LLM`: login, modelo (`modelos\`), logs (`logs\`) e o
`config.json` opcional.

## Configuração

Crie `%APPDATA%\X.LLM\config.json` com só o que quiser mudar e reabra o app. Exemplo:

```json
{
  "dispositivo": "Vulkan1",
  "traduzirImagens": true
}
```

| Opção | Padrão GPU | Padrão CPU | O que é |
|---|---|---|---|
| `modelo` | `translategemma-4b-it.Q6_K.gguf` | `translategemma-4b-it.Q4_K_M.gguf` | Nome de um arquivo do [repositório de GGUFs](https://huggingface.co/mradermacher/translategemma-4b-it-GGUF) (baixado sozinho) ou caminho completo de um `.gguf` |
| `traduzirImagens` | `true` | `false` | Traduz o texto dentro das fotos |
| `dispositivo` | automático | — | Placa usada pelo llama-server (`Vulkan0`, `Vulkan1`...). Com 2+ placas, o padrão divide o modelo entre elas |
| `camadasGpu` | `99` | `0` | Camadas do modelo na placa de vídeo |
| `simultaneos` | `4` | `2` | Traduções em paralelo |
| `contexto` | `16384` | `8192` | Contexto total do llama-server (dividido entre as traduções em paralelo) |
| `threads` | automático | automático | Threads de CPU do llama-server |
| `llamaServer` | o embutido | o embutido | Caminho de outro `llama-server.exe` (ex.: um build CUDA seu; aí `dispositivo` vira `CUDA0`, `CUDA1`...) |
| `portaLlm` / `portaOcr` | `8099` / `8097` | `8099` / `8097` | Portas locais dos serviços |

Para ver as placas que o llama-server enxerga:
`"%LOCALAPPDATA%\Programs\X.LLM\resources\llama\llama-server.exe" --list-devices`

## Atalhos

`Alt+←` voltar · `Alt+→` avançar · `F5` recarregar · `F12` DevTools

## Problemas comuns

- **Não traduz nada**: veja `%APPDATA%\X.LLM\logs\llama-server.log`. Falta de memória de vídeo
  aparece ali; tente a versão CPU ou um modelo menor (`"modelo": "translategemma-4b-it.Q4_K_M.gguf"`).
- **Primeiras traduções lentas na GPU**: na primeira vez o driver compila os shaders do Vulkan;
  depois fica rápido.
- **Fotos não são traduzidas**: na versão CPU isso vem desligado. Na GPU, veja `logs\ocr.log`.
- **Porta em uso**: mude `portaLlm` / `portaOcr` no `config.json`.

## Desenvolvimento

Precisa de [Node.js](https://nodejs.org) 22+ e, para gerar os binários do OCR,
[uv](https://docs.astral.sh/uv/) (ele baixa o Python 3.12 sozinho).

```bat
npm install
npm run preparar:gpu   :: baixa o llama.cpp (Vulkan) e gera o OCR em vendor\gpu
npm start              :: roda a versão GPU a partir do código

npm run preparar:cpu
npm run start:cpu      :: versão CPU

npm run dist:gpu       :: instalador em dist\X.LLM-GPU-Setup-<versão>.exe
npm run dist:cpu       :: instalador em dist\X.LLM-CPU-Setup-<versão>.exe
```

Rodando do código, se existir `modelo\<arquivo>.gguf` na pasta do projeto ele é usado direto (sem
baixar). Sem `vendor\<variante>\ocr`, o OCR roda com o Python de `ocr\.venv`:

```bat
cd ocr
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements-gpu.txt
```

`node scripts/preparar.js gpu --forcar --llama=b11868` refaz os binários fixando a versão do
llama.cpp. Publicar uma tag `v*` no GitHub dispara o workflow que gera os dois instaladores e cria o
release.

### Estrutura

```
src/
  main.js       janela, CSS injetado no X, atalhos, download do modelo
  preload.js    roda dentro do x.com: acha tweets/bios/fotos e mostra as traduções
  tradutor.js   fila de traduções no llama-server (TranslateGemma)
  imagens.js    tradução do texto das fotos (OCR + tradutor)
  modelo.js     baixa o modelo do Hugging Face na primeira vez
  servico.js    sobe/derruba os processos locais (llama-server, OCR)
  config.js     variante CPU/GPU, caminhos e config.json do usuário
ocr/
  servidor.py   servidor HTTP do OCR (RapidOCR), congelado com PyInstaller no build
scripts/
  preparar.js   baixa o llama.cpp e gera o OCR da variante em vendor\
  empacotar.js  gera o instalador com electron-builder
  gerar-icone.js
build/          ícone
```

## Licença e créditos

Código sob a [licença MIT](LICENSE).

O app baixa ou embute componentes de terceiros, cada um com sua licença:

- [TranslateGemma](https://huggingface.co/google/translategemma-4b-it) (Google): [Gemma Terms of Use](https://ai.google.dev/gemma/terms). Não é distribuído com o app; é baixado na primeira execução, a partir das [quantizações GGUF do mradermacher](https://huggingface.co/mradermacher/translategemma-4b-it-GGUF).
- [llama.cpp](https://github.com/ggml-org/llama.cpp): MIT
- [RapidOCR](https://github.com/RapidAI/RapidOCR) e modelos [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR): Apache 2.0
- [ONNX Runtime](https://github.com/microsoft/onnxruntime): MIT; DirectML: licença de redistribuição da Microsoft
- [OpenCV](https://opencv.org): Apache 2.0
- [eld](https://github.com/nitotm/efficient-language-detector-js): Apache 2.0
- [Electron](https://www.electronjs.org): MIT
