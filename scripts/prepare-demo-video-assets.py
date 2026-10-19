from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


WIDTH = 1920
HEIGHT = 1080
INK = "#142126"
INK_RAISED = "#1b2c30"
PAPER = "#f8f9f5"
MUTED = "#a5b8b5"
PETROL = "#315d68"
RED = "#a84732"
RULE = "#324347"
FONT_REGULAR = Path(r"C:\Windows\Fonts\Deng.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\Dengb.ttf")
PADDING_SECONDS = 0.75


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    value: str,
    font_obj: ImageFont.FreeTypeFont,
    fill: str,
) -> None:
    draw.text(xy, value, font=font_obj, fill=fill)


def fit_text(
    draw: ImageDraw.ImageDraw,
    value: str,
    max_width: int,
    font_obj: ImageFont.FreeTypeFont,
) -> str:
    if draw.textlength(value, font=font_obj) <= max_width:
        return value
    suffix = "..."
    low, high = 0, len(value)
    while low < high:
        middle = (low + high + 1) // 2
        candidate = value[:middle].rstrip() + suffix
        if draw.textlength(candidate, font=font_obj) <= max_width:
            low = middle
        else:
            high = middle - 1
    return value[:low].rstrip() + suffix


def make_slide(scene: dict, project_root: Path, target: Path) -> None:
    canvas = Image.new("RGB", (WIDTH, HEIGHT), INK)
    draw = ImageDraw.Draw(canvas)
    title_font = font(FONT_BOLD, 48)
    kicker_font = font(FONT_BOLD, 18)
    bullet_font = font(FONT_REGULAR, 22)
    number_font = font(FONT_BOLD, 78)
    footer_font = font(FONT_REGULAR, 15)

    draw.rectangle((0, 0, WIDTH, 12), fill=RED)
    draw.rectangle((58, 62, 64, 187), fill=RED)
    text(draw, (88, 56), scene["number"], number_font, "#617875")
    text(draw, (192, 62), scene["kicker"], kicker_font, MUTED)
    title = fit_text(draw, scene["title"], 1600, title_font)
    text(draw, (192, 91), title, title_font, PAPER)

    bullet_y = 158
    for bullet in scene["bullets"][:3]:
        draw.ellipse((194, bullet_y + 9, 200, bullet_y + 15), fill=RED)
        value = fit_text(draw, bullet, 1610, bullet_font)
        text(draw, (215, bullet_y), value, bullet_font, "#d8e1dd")
        bullet_y += 31

    panel = (72, 277, WIDTH - 72, HEIGHT - 58)
    draw.rectangle(panel, fill=INK_RAISED, outline=RULE, width=2)
    draw.rectangle((91, 296, 118, 323), outline=RED, width=3)
    draw.rectangle((98, 303, 111, 316), fill=RED)

    source = project_root / "outputs" / scene["image"]
    with Image.open(source) as raw:
        image = raw.convert("RGB")
        fitted = ImageOps.contain(
            image,
            (panel[2] - panel[0] - 36, panel[3] - panel[1] - 36),
            method=Image.Resampling.LANCZOS,
        )
        x = panel[0] + (panel[2] - panel[0] - fitted.width) // 2
        y = panel[1] + (panel[3] - panel[1] - fitted.height) // 2
        canvas.paste(fitted, (x, y))
        draw.rectangle(
            (x - 1, y - 1, x + fitted.width, y + fitted.height),
            outline="#6f817e",
            width=2,
        )

    draw.line((72, 1026, WIDTH - 72, 1026), fill=RULE, width=1)
    text(
        draw,
        (72, 1041),
        "SCHOLAR  /  SCIENTIFIC EVIDENCE AUDITOR  /  2026",
        footer_font,
        MUTED,
    )
    scene_label = f"SCENE {scene['number']} / 10"
    label_width = draw.textlength(scene_label, font=footer_font)
    text(draw, (WIDTH - 72 - int(label_width), 1041), scene_label, footer_font, MUTED)
    canvas.save(target, format="PNG", optimize=True)


def pad_wave(source: Path, target: Path, padding_seconds: float) -> float:
    with wave.open(str(source), "rb") as reader:
        params = reader.getparams()
        frames = reader.readframes(reader.getnframes())
        duration = reader.getnframes() / reader.getframerate()
    padding_frames = int(params.framerate * padding_seconds)
    silence = b"\x00" * padding_frames * params.sampwidth * params.nchannels
    with wave.open(str(target), "wb") as writer:
        writer.setparams(params)
        writer.writeframes(frames)
        writer.writeframes(silence)
    return duration + padding_seconds


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--skip-narration", action="store_true")
    parser.add_argument("--finalize-audio", action="store_true")
    args = parser.parse_args()

    scenes = json.loads((args.assets / "scenes.json").read_text(encoding="utf-8-sig"))
    slides = args.assets / "slides"
    narration_raw = args.assets / "narration-raw"
    narration = args.assets / "narration"
    slides.mkdir(parents=True, exist_ok=True)
    narration.mkdir(parents=True, exist_ok=True)

    if not args.finalize_audio:
        for scene in scenes:
            make_slide(scene, args.project_root, slides / f"scene-{scene['number']}.png")
        return

    slide_lines: list[str] = []
    audio_lines: list[str] = []
    segment_lines: list[str] = []
    durations: dict[str, float] = {}
    for scene in scenes:
        source = narration_raw / f"scene-{scene['number']}.wav"
        target = narration / f"scene-{scene['number']}.wav"
        if not source.exists():
            raise FileNotFoundError(f"Missing narration: {source}")
        duration = pad_wave(source, target, PADDING_SECONDS)
        durations[scene["number"]] = duration
        slide = slides / f"scene-{scene['number']}.png"
        slide_lines.extend(
            [
                f"file 'slides/{slide.name}'",
                f"duration {duration:.3f}",
            ]
        )
        audio_lines.append(f"file 'narration/{target.name}'")
        segment_lines.append(f"file 'segments/scene-{scene['number']}.mp4'")

    if scenes:
        last_slide = slides / f"scene-{scenes[-1]['number']}.png"
        slide_lines.append(f"file 'slides/{last_slide.name}'")
    (args.assets / "slides.txt").write_text("\n".join(slide_lines) + "\n", encoding="utf-8")
    (args.assets / "audio.txt").write_text("\n".join(audio_lines) + "\n", encoding="utf-8")
    (args.assets / "segments.txt").write_text(
        "\n".join(segment_lines) + "\n",
        encoding="utf-8",
    )
    (args.assets / "durations.json").write_text(
        json.dumps(durations, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
