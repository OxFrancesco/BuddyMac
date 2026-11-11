import { configureMenuBar, menuBarState, toggleMenuBar, type MenuBarState } from './platform'
import type { MenuBarSettings } from './surfaces'

/** Shown when the user drags BuddyMac's arrow left of its divider: hiding would take the arrow with it. */
export const misplacedMessage = 'Command-drag the BuddyMac arrow back to the right of its divider, then hide icons again.'

let launched = false
/**
 * Puts the arrow and divider in the menu bar, or removes them. The first call with the feature on after launch hides
 * icons straight away when `hideOnLaunch` is set; later calls keep whatever the user last chose.
 */
export function applyMenuBar(settings: MenuBarSettings, loaded: boolean) {
  const collapse = loaded && !launched && settings.enabled && settings.hideOnLaunch
  if (loaded) launched = true
  configureMenuBar(settings.enabled, settings.autoHide, collapse)
}

export function toggleMenuBarIcons(): MenuBarState { return toggleMenuBar() }
export const currentMenuBarState = (): MenuBarState => menuBarState()
