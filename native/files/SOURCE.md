The shelf store was adapted from `/Volumes/T6-7/Coding/Personal/BuddyFiles/Store.swift`, commit `be77e0d80da72495be002ff875086ee3c996bc9b`.

BuddyMac keeps the original advisory locking and atomic manifest writes. It writes to its own Files directory, imports original references under a read-only shared lock, and never deletes source files. Metadata lookup isolates optional Launch Services type descriptions so an unavailable description cannot mark an existing file as missing.

The native Files helper adds a JSON interface and AppKit file selection, pasteboard, open, and reveal operations. Dragging is handled by BuddyMac's in-process platform bridge.
