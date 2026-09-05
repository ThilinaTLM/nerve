use std::rc::Rc;

use gpui::App;
use gpui_component::{Theme, ThemeConfig, ThemeMode, ThemeSet};

const NERVE_THEME: &str = include_str!("../themes/nerve-dark.json");
const NERVE_DARK_NAME: &str = "Nerve Dark";

fn nerve_dark_config() -> ThemeConfig {
    let theme_set: ThemeSet = serde_json::from_str(NERVE_THEME)
        .expect("bundled themes/nerve-dark.json must be a valid gpui-component ThemeSet");

    theme_set
        .themes
        .into_iter()
        .find(|theme| theme.name.as_ref() == NERVE_DARK_NAME && theme.mode == ThemeMode::Dark)
        .expect("bundled theme set must contain the Nerve Dark theme")
}

pub fn apply_default_theme(cx: &mut App) {
    let config = Rc::new(nerve_dark_config());
    Theme::global_mut(cx).apply_config(&config);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_theme_is_valid_and_dark() {
        let theme = nerve_dark_config();

        assert_eq!(theme.name.as_ref(), NERVE_DARK_NAME);
        assert_eq!(theme.mode, ThemeMode::Dark);
        assert!(theme.is_default);
    }

    #[test]
    fn bundled_theme_has_required_nerve_tokens() {
        let colors = nerve_dark_config().colors;

        assert_eq!(colors.background.unwrap().to_string(), "#262624");
        assert_eq!(colors.foreground.unwrap().to_string(), "#DEDEDC");
        assert_eq!(colors.primary.unwrap().to_string(), "#D97757");
        assert_eq!(colors.border.unwrap().to_string(), "#3E3E38");
        assert_eq!(colors.sidebar.unwrap().to_string(), "#1F1E1D");
        assert_eq!(colors.sidebar_foreground.unwrap().to_string(), "#C3C0B6");
    }
}
