"""Voice comparison: the same lines of Mack's through several speech models, for the user to listen to.

    python gen.py design            Qwen3-TTS VoiceDesign: a voice from each description in lines.json -> voices/<id>.wav
    python gen.py qwen|chatterbox|f5 [--voice gravel]
                                    each line in the voice of voices/<voice>.wav -> <model>/<nn>-<line>.wav

Each model runs in a venv of its own (run.sh): their pins of PyTorch and transformers don't agree. Fish Audio S2 and
Higgs TTS 3 have runners of their own (fish.sh, higgs.py): one is a three-step command line, the other a server.
Nothing here is wired into the game; the clips go to debug-shots/voice/ and index.mjs makes the page to hear them on.
"""
import argparse
import json
import os
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = json.loads((HERE / "lines.json").read_text(encoding="utf8"))
OUT = Path(os.environ.get("VOICE_OUT", HERE.parent.parent / "debug-shots" / "voice"))


def numbered(lines):
    order = {l["id"]: i + 1 for i, l in enumerate(SPEC["lines"])}
    return [(f"{order[l['id']]:02d}-{l['id']}", l["text"]) for l in lines]


def design():
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map="cuda:0", dtype=torch.bfloat16)
    out = OUT / "voices"
    out.mkdir(parents=True, exist_ok=True)
    for v in SPEC["voices"]:
        wavs, sr = model.generate_voice_design(text=SPEC["ref_text"], language=SPEC["language"], instruct=v["instruct"])
        sf.write(out / f"{v['id']}.wav", wavs[0], sr)
        print("voice", v["id"], f"{len(wavs[0]) / sr:.1f}s", flush=True)


def qwen(ref, out):
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    model = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.bfloat16)
    prompt = model.create_voice_clone_prompt(ref_audio=str(ref), ref_text=SPEC["ref_text"])
    for name, text in numbered(SPEC["lines"]):
        wavs, sr = model.generate_voice_clone(text=text, language=SPEC["language"], voice_clone_prompt=prompt)
        sf.write(out / f"{name}.wav", wavs[0], sr)
        yield name


def chatterbox(ref, out):
    import torchaudio as ta
    from chatterbox.tts import ChatterboxTTS

    model = ChatterboxTTS.from_pretrained(device="cuda")
    # The defaults, then slower and a little more feeling: the settings a weary read would use.
    for tag, kw in (("", {}), ("-slow", {"exaggeration": 0.6, "cfg_weight": 0.3})):
        for name, text in numbered(SPEC["lines"]):
            wav = model.generate(text, audio_prompt_path=str(ref), **kw)
            ta.save(str(out / f"{name}{tag}.wav"), wav, model.sr)
            yield name + tag


def f5(ref, out):
    from f5_tts.api import F5TTS

    model = F5TTS()
    for name, text in numbered(SPEC["lines"]):
        model.infer(ref_file=str(ref), ref_text=SPEC["ref_text"], gen_text=text, file_wave=str(out / f"{name}.wav"), seed=17)
        yield name


MODELS = {"qwen": qwen, "chatterbox": chatterbox, "f5": f5}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("model", choices=["design", *MODELS])
    ap.add_argument("--voice", default="gravel")
    a = ap.parse_args()
    if a.model == "design":
        design()
    else:
        ref = OUT / "voices" / f"{a.voice}.wav"
        out = OUT / a.model
        out.mkdir(parents=True, exist_ok=True)
        t = time.time()
        for name in MODELS[a.model](ref, out):
            print(a.model, name, f"{time.time() - t:.1f}s", flush=True)
            t = time.time()
