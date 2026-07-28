#!/usr/bin/env python3
"""Generate Nerve's original notification tones without external audio samples."""

from __future__ import annotations

import argparse
import math
import random
import re
import shutil
import struct
import subprocess
import tempfile
import wave
from collections.abc import Callable
from pathlib import Path

SAMPLE_RATE = 32_000
SOURCE_PEAK_DB = -22.0
OUTPUT_PEAK_DB = -18.0

SampleFunction = Callable[[float], float]


def envelope(position: float, duration: float, attack: float, decay: float) -> float:
    if position < 0.0 or position >= duration:
        return 0.0
    attack_level = math.sin(min(1.0, position / attack) * math.pi / 2.0)
    release = min(1.0, (duration - position) / 0.045)
    return attack_level * math.exp(-decay * position / duration) * release


def note(
    time: float,
    *,
    start: float,
    duration: float,
    frequency: float,
    end_frequency: float | None = None,
    attack: float = 0.008,
    decay: float = 2.4,
    harmonics: tuple[tuple[float, float], ...] = ((1.0, 1.0),),
) -> float:
    position = time - start
    if position < 0.0 or position >= duration:
        return 0.0
    final_frequency = end_frequency or frequency
    sweep = (final_frequency - frequency) / duration
    phase = 2.0 * math.pi * (
        frequency * position + 0.5 * sweep * position * position
    )
    waveform = sum(
        amplitude * math.sin(phase * multiple)
        for multiple, amplitude in harmonics
    )
    return envelope(position, duration, attack, decay) * waveform


def ping(time: float) -> float:
    return note(
        time,
        start=0.0,
        duration=0.42,
        frequency=1_050.0,
        end_frequency=920.0,
        decay=3.2,
        harmonics=((1.0, 1.0), (2.0, 0.22), (3.0, 0.08)),
    )


def pulse(time: float) -> float:
    first = note(
        time,
        start=0.0,
        duration=0.24,
        frequency=440.0,
        decay=2.8,
        harmonics=((1.0, 1.0), (2.0, 0.12)),
    )
    second = note(
        time,
        start=0.16,
        duration=0.24,
        frequency=554.37,
        decay=2.8,
        harmonics=((1.0, 0.9), (2.0, 0.1)),
    )
    return first + second


def ripple(time: float) -> float:
    frequencies = (783.99, 659.25, 523.25)
    return sum(
        note(
            time,
            start=index * 0.09,
            duration=0.3,
            frequency=frequency,
            end_frequency=frequency * 0.94,
            decay=2.5,
            harmonics=((1.0, 1.0), (2.0, 0.1)),
        )
        for index, frequency in enumerate(frequencies)
    )


def sparkle(time: float) -> float:
    frequencies = (1_046.5, 1_318.51, 1_567.98, 2_093.0)
    return sum(
        note(
            time,
            start=index * 0.07,
            duration=0.3,
            frequency=frequency,
            decay=3.4,
            harmonics=((1.0, 1.0), (2.0, 0.14), (2.7, 0.05)),
        )
        for index, frequency in enumerate(frequencies)
    )


def make_knock() -> SampleFunction:
    random_source = random.Random(3747)
    noise = [random_source.uniform(-1.0, 1.0) for _ in range(int(0.22 * SAMPLE_RATE))]

    def knock(time: float) -> float:
        index = min(len(noise) - 1, int(time * SAMPLE_RATE))
        position = max(0.0, time)
        body = note(
            time,
            start=0.0,
            duration=0.2,
            frequency=220.0,
            end_frequency=92.0,
            attack=0.001,
            decay=5.2,
            harmonics=((1.0, 1.0), (2.0, 0.32), (3.0, 0.12)),
        )
        transient = noise[index] * math.exp(-38.0 * position)
        return body + 0.42 * transient

    return knock


def signal(time: float) -> float:
    first = note(
        time,
        start=0.0,
        duration=0.15,
        frequency=659.25,
        attack=0.012,
        decay=1.2,
    )
    second = note(
        time,
        start=0.24,
        duration=0.15,
        frequency=880.0,
        attack=0.012,
        decay=1.2,
    )
    return first + second


TONE_DEFINITIONS: dict[str, tuple[float, SampleFunction]] = {
    "ping": (0.42, ping),
    "pulse": (0.42, pulse),
    "ripple": (0.5, ripple),
    "sparkle": (0.55, sparkle),
    "knock": (0.22, make_knock()),
    "signal": (0.48, signal),
}


def render_wave(path: Path, duration: float, sample_function: SampleFunction) -> None:
    samples = [
        sample_function(index / SAMPLE_RATE)
        for index in range(math.ceil(duration * SAMPLE_RATE))
    ]
    maximum = max(abs(sample) for sample in samples)
    target = 10.0 ** (SOURCE_PEAK_DB / 20.0)
    scale = target / maximum
    pcm = b"".join(
        struct.pack("<h", round(max(-1.0, min(1.0, sample * scale)) * 32_767))
        for sample in samples
    )
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm)


def measured_peak(path: Path) -> float:
    process = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(path),
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r"max_volume:\s*(-?[0-9.]+) dB", process.stderr)
    if not match:
        raise RuntimeError(f"Could not measure peak level for {path}")
    return float(match.group(1))


def encode_mp3(source: Path, destination: Path) -> float:
    gain = 0.0
    peak = SOURCE_PEAK_DB
    for _ in range(4):
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-y",
                "-i",
                str(source),
                "-map_metadata",
                "-1",
                "-af",
                f"volume={gain:.2f}dB",
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "48k",
                str(destination),
            ],
            check=True,
        )
        peak = measured_peak(destination)
        error = OUTPUT_PEAK_DB - peak
        if abs(error) <= 0.5:
            break
        gain += error
    return peak


def main() -> None:
    parser = argparse.ArgumentParser()
    default_output = (
        Path(__file__).resolve().parents[1]
        / "packages"
        / "workbench-app"
        / "public"
        / "sounds"
    )
    parser.add_argument("--output-dir", type=Path, default=default_output)
    arguments = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is required to encode notification tones")

    arguments.output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="nerve-notification-tones-") as temp:
        temp_directory = Path(temp)
        for name, (duration, sample_function) in TONE_DEFINITIONS.items():
            wave_path = temp_directory / f"{name}.wav"
            output_path = arguments.output_dir / f"{name}.mp3"
            render_wave(wave_path, duration, sample_function)
            peak = encode_mp3(wave_path, output_path)
            print(
                f"{output_path.name}: {output_path.stat().st_size} bytes, "
                f"{duration:.2f}s, peak {peak:.1f} dBFS"
            )


if __name__ == "__main__":
    main()
