pub mod tokens;

use clap::ValueEnum;
use gpui::{Hsla, Rgba, WindowAppearance};

use tokens::{DARK, LIGHT, Oklch};

pub const UI_FONT: &str = "Outfit";
pub const MONO_FONT: &str = "Iosevka";
pub const HEADER_HEIGHT: f32 = 48.0;
pub const RAIL_HEIGHT: f32 = 32.0;
pub const STATUS_HEIGHT: f32 = 28.0;
#[cfg(test)]
pub const BASE_RADIUS: f32 = 10.0;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, ValueEnum)]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

impl ThemeMode {
    #[must_use]
    pub fn resolve(self, appearance: WindowAppearance) -> Theme {
        match self {
            Self::Light => Theme::light(),
            Self::Dark => Theme::dark(),
            Self::System => match appearance {
                WindowAppearance::Light | WindowAppearance::VibrantLight => Theme::light(),
                WindowAppearance::Dark | WindowAppearance::VibrantDark => Theme::dark(),
            },
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Copy)]
pub struct Theme {
    pub is_dark: bool,
    pub background: Hsla,
    pub foreground: Hsla,
    pub card: Hsla,
    pub card_foreground: Hsla,
    pub popover: Hsla,
    pub popover_foreground: Hsla,
    pub primary: Hsla,
    pub primary_foreground: Hsla,
    pub secondary: Hsla,
    pub secondary_foreground: Hsla,
    pub muted: Hsla,
    pub muted_foreground: Hsla,
    pub accent: Hsla,
    pub accent_foreground: Hsla,
    pub destructive: Hsla,
    pub destructive_foreground: Hsla,
    pub destructive_solid: Hsla,
    pub destructive_solid_foreground: Hsla,
    pub success: Hsla,
    pub success_foreground: Hsla,
    pub warning: Hsla,
    pub warning_foreground: Hsla,
    pub info: Hsla,
    pub info_foreground: Hsla,
    pub border: Hsla,
    pub input: Hsla,
    pub ring: Hsla,
    pub sidebar: Hsla,
    pub sidebar_foreground: Hsla,
    pub sidebar_accent: Hsla,
    pub sidebar_accent_foreground: Hsla,
    pub sidebar_primary: Hsla,
    pub sidebar_primary_foreground: Hsla,
    pub sidebar_border: Hsla,
    pub sidebar_ring: Hsla,
}

impl Theme {
    #[must_use]
    pub fn light() -> Self {
        Self::from_source(false, &LIGHT)
    }

    #[must_use]
    pub fn dark() -> Self {
        Self::from_source(true, &DARK)
    }

    fn from_source(is_dark: bool, source: &[Oklch; 35]) -> Self {
        let color = |index| oklch_to_rgba(source[index]).into();
        Self {
            is_dark,
            background: color(0),
            foreground: color(1),
            card: color(2),
            card_foreground: color(3),
            popover: color(4),
            popover_foreground: color(5),
            primary: color(6),
            primary_foreground: color(7),
            secondary: color(8),
            secondary_foreground: color(9),
            muted: color(10),
            muted_foreground: color(11),
            accent: color(12),
            accent_foreground: color(13),
            destructive: color(14),
            destructive_foreground: color(15),
            destructive_solid: color(16),
            destructive_solid_foreground: color(17),
            success: color(18),
            success_foreground: color(19),
            warning: color(20),
            warning_foreground: color(21),
            info: color(22),
            info_foreground: color(23),
            border: color(24),
            input: color(25),
            ring: color(26),
            sidebar: color(27),
            sidebar_foreground: color(28),
            sidebar_accent: color(29),
            sidebar_accent_foreground: color(30),
            sidebar_primary: color(31),
            sidebar_primary_foreground: color(32),
            sidebar_border: color(33),
            sidebar_ring: color(34),
        }
    }
}

#[must_use]
pub fn oklch_to_rgba(color: Oklch) -> Rgba {
    let radians = color.h.to_radians();
    let a = color.c * radians.cos();
    let b = color.c * radians.sin();
    let l = color.l;
    let l_root = (l + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m_root = (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s_root = (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);

    let linear_r = 4.076_741_7 * l_root - 3.307_711_6 * m_root + 0.230_969_94 * s_root;
    let linear_g = -1.268_438 * l_root + 2.609_757_4 * m_root - 0.341_319_38 * s_root;
    let linear_b = -0.004_196_086_3 * l_root - 0.703_418_6 * m_root + 1.707_614_7 * s_root;
    let gamma = |channel: f32| {
        let value = if channel <= 0.003_130_8 {
            12.92 * channel
        } else {
            1.055 * channel.powf(1.0 / 2.4) - 0.055
        };
        value.clamp(0.0, 1.0)
    };
    Rgba {
        r: gamma(linear_r),
        g: gamma(linear_g),
        b: gamma(linear_b),
        a: 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_tokens_match_authoritative_css() {
        let css = include_str!("../../../../packages/ui-kit/src/styles/theme.css");
        let root = css
            .split(":root {")
            .nth(1)
            .unwrap()
            .split("\n}")
            .next()
            .unwrap();
        let dark = css
            .split(".dark {")
            .nth(1)
            .unwrap()
            .split("\n}")
            .next()
            .unwrap();
        for (index, name) in tokens::TOKEN_NAMES.iter().enumerate() {
            assert_css_token(root, name, tokens::LIGHT[index]);
            assert_css_token(dark, name, tokens::DARK[index]);
        }
        assert!(root.contains(&format!("--radius: {}rem;", BASE_RADIUS / 16.0)));
    }

    fn assert_css_token(block: &str, name: &str, expected: Oklch) {
        let prefix = format!("--{name}: oklch(");
        let line = block
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with(&prefix))
            .unwrap_or_else(|| panic!("missing CSS token {name}"));
        let values = line
            .trim_start_matches(&prefix)
            .trim_end_matches(");")
            .split_whitespace()
            .map(|value| value.parse::<f32>().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(values.len(), 3, "invalid CSS token {name}");
        assert!(
            (values[0] - expected.l).abs() < 0.00001,
            "lightness drift for {name}"
        );
        assert!(
            (values[1] - expected.c).abs() < 0.00001,
            "chroma drift for {name}"
        );
        assert!(
            (values[2] - expected.h).abs() < 0.0001,
            "hue drift for {name}"
        );
    }

    #[test]
    fn neutral_extremes_convert_to_srgb() {
        let black = oklch_to_rgba(Oklch::new(0.0, 0.0, 0.0));
        let white = oklch_to_rgba(Oklch::new(1.0, 0.0, 0.0));
        assert!(black.r.abs() < 0.0001 && black.g.abs() < 0.0001 && black.b.abs() < 0.0001);
        assert!((white.r - 1.0).abs() < 0.0001);
        assert!((white.g - 1.0).abs() < 0.0001);
        assert!((white.b - 1.0).abs() < 0.0001);
    }
}
