use std::borrow::Cow;

use gpui::{AssetSource, Result, SharedString};

pub struct NerveAssets;

impl AssetSource for NerveAssets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        let bytes: Option<&'static [u8]> = match path {
            "icons/message-square.svg" => {
                Some(include_bytes!("../assets/icons/message-square.svg"))
            }
            "icons/lock.svg" => Some(include_bytes!("../assets/icons/lock.svg")),
            _ => None,
        };
        Ok(bytes.map(Cow::Borrowed))
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        if path == "icons" {
            Ok(vec![
                "icons/message-square.svg".into(),
                "icons/lock.svg".into(),
            ])
        } else {
            Ok(Vec::new())
        }
    }
}

pub fn register_fonts(cx: &mut gpui::App) -> Result<()> {
    cx.text_system().add_fonts(vec![
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/outfit-latin-400-normal.woff2"
        )),
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/outfit-latin-500-normal.woff2"
        )),
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/outfit-latin-600-normal.woff2"
        )),
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/iosevka-latin-400-normal.woff2"
        )),
        Cow::Borrowed(include_bytes!(
            "../assets/fonts/iosevka-latin-500-normal.woff2"
        )),
    ])
}
