use std::rc::Rc;

use gpui::{App, Window};

/// A callback that receives the index of the element that triggered it.
/// Used for tab selection, closing a tab, etc.
pub(super) type IndexCallback = Rc<dyn Fn(&usize, &mut Window, &mut App)>;

/// A simple action callback that receives the window and app contexts.
/// Used for toggle buttons, "add" buttons, etc.
pub(super) type ActionCallback = Rc<dyn Fn(&mut Window, &mut App)>;

/// A callback carrying a stable server-backed record identity.
pub(super) type StringCallback = Rc<dyn Fn(&String, &mut Window, &mut App)>;
