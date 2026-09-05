export interface Settings {
  // ActiveScriptsServerPageSize: number
  // ActiveScriptsScriptPageSize: number
  // AutoexecScript: string
  // AutosaveInterval: number
  // DisableASCIIArt: boolean
  // DisableHotkeys: boolean
  // DisableTextEffects: boolean
  // DisableOverviewProgressBars: boolean
  // EnableBashHotkeys: boolean
  // EnableHistorySearch: boolean
  // GoTraditionalStyle: boolean
  // TimestampsFormat: string
  Locale: string
  // MaxRecentScriptsCapacity: number
  // MaxLogCapacity: number
  // MaxPortCapacity: number
  // MaxTerminalCapacity: number
  // RemoteFileApiAddress: string
  // RemoteFileApiPort: number
  // RemoteFileApiReconnectionDelay: number
  // UseWssForRemoteFileApi: boolean
  // SaveGameOnFileSave: boolean
  // SuppressBuyAugmentationConfirmation: boolean
  // SuppressErrorModals: boolean
  // SuppressFactionInvites: boolean
  // SuppressMessages: boolean
  // SuppressTravelConfirmation: boolean
  // SuppressBladeburnerPopup: boolean
  // SuppressTIXPopup: boolean
  // SuppressSavedGameToast: boolean
  // SuppressAutosaveDisabledWarnings: boolean
  UseIEC60027_2: boolean
  // ShowMiddleNullTimeUnit: boolean
  // ExcludeRunningScriptsFromSave: boolean
  // IsSidebarOpened: boolean
  // TailRenderInterval: number
  // theme: Theme
  // styles: Styles
  // overview: Overview
  // EditorTheme: EditorTheme
  // OwnedAugmentationsOrder: number
  // PurchaseAugmentationsOrder: number
  // MonacoTheme: string
  // MonacoInsertSpaces: boolean
  // MonacoTabSize: number
  // MonacoDetectIndentation: boolean
  // MonacoFontFamily: string
  // MonacoFontSize: number
  // MonacoFontLigatures: boolean
  // MonacoDefaultToVim: boolean
  // MonacoWordWrap: string
  // MonacoBeautifyOnSave: boolean
  // MonacoCursorStyle: string
  // MonacoCursorBlinking: string
  // MonacoStickyScroll: MonacoStickyScroll
  // MonacoMinimap: MonacoMinimap
  // MonacoAutoSaveOnFocusChange: boolean
  hideTrailingDecimalZeros: boolean
  hideThousandsSeparator: boolean
  useEngineeringNotation: boolean
  disableSuffixes: boolean
  fractionalDigits: number
  CurrencySymbol: string
  CurrencySymbolAfterValue: boolean
  // KeyBindings: KeyBindings
  // SyncSteamAchievements: boolean
}

// export interface Theme {
//   primarylight: string
//   primary: string
//   primarydark: string
//   successlight: string
//   success: string
//   successdark: string
//   errorlight: string
//   error: string
//   errordark: string
//   secondarylight: string
//   secondary: string
//   secondarydark: string
//   warninglight: string
//   warning: string
//   warningdark: string
//   infolight: string
//   info: string
//   infodark: string
//   welllight: string
//   well: string
//   white: string
//   black: string
//   hp: string
//   money: string
//   hack: string
//   combat: string
//   cha: string
//   int: string
//   rep: string
//   disabled: string
//   backgroundprimary: string
//   backgroundsecondary: string
//   button: string
//   maplocation: string
//   bnlvl0: string
//   bnlvl1: string
//   bnlvl2: string
//   bnlvl3: string
// }

// export interface Styles {
//   lineHeight: number
//   fontSize: number
//   tailFontSize: number
//   fontFamily: string
// }

// export interface Overview {
//   x: number
//   y: number
//   opened: boolean
// }

// export interface EditorTheme {
//   base: string
//   inherit: boolean
//   common: Common
//   syntax: Syntax
//   ui: Ui
// }

// export interface Common {
//   accent: string
//   bg: string
//   fg: string
// }

// export interface Syntax {
//   tag: string
//   entity: string
//   string: string
//   regexp: string
//   markup: string
//   keyword: string
//   comment: string
//   constant: string
//   error: string
// }

// export interface Ui {
//   line: string
//   panel: Panel
//   selection: Selection
// }

// export interface Panel {
//   bg: string
//   selected: string
//   border: string
// }

// export interface Selection {
//   bg: string
// }

// export interface MonacoStickyScroll {
//   enabled: boolean
// }

// export interface MonacoMinimap {
//   enabled: boolean
// }

// export interface KeyBindings {}

interface DecompressionStreamObj extends GenericTransformStream { }
type CompressionFormat = 'deflate' | 'deflate-raw' | 'gzip'
declare const DecompressionStream: {
  prototype: DecompressionStreamObj
  new(format: CompressionFormat): DecompressionStreamObj
}

function reload(): Promise<Settings | null> {
  const request = indexedDB.open('bitburnerSave')

  return new Promise((resolve, reject) => {
    request.onsuccess = async () => {
      const db = request.result
      const transaction = db.transaction(['savestring'], 'readonly')
      const store = transaction.objectStore('savestring')
      const getRequest = store.get('save')

      getRequest.onsuccess = async () => {
        const compressedBytes = getRequest.result // The Uint8Array

        try {
          // Create a decompression stream for gzip data
          const stream = new Blob([compressedBytes]).stream()
          const decompressionStream = new DecompressionStream('gzip')
          const decompressedStream = stream.pipeThrough(decompressionStream)

          // Read the stream back into text
          const response = new Response(decompressedStream)
          const rawText = await response.text()

          // Try parsing the inner JSON structure
          const gameObject = JSON.parse(rawText)
          resolve(JSON.parse(gameObject.data.SettingsSave))
        }
        catch (err) {
          reject(new Error(`Decompression failed. Ensure the save isn't corrupted: ${err}`))
        }
      }
      getRequest.onerror = () => {
        reject(new Error('Could not read settings from IndexedDB'))
      }
    }
    request.onerror = () => {
      reject(new Error('Could not establish a connection to IndexedDB'))
    }
  })
}

/**
 * Synchronous, cached view of the fields of `Settings` (see the interface above for the full field list) actually
 * needed by synchronous consumers (currently `utils/format/game.ts`). Seeded with defaults so it's always safe to
 * read before the first `reload()` resolves; mutated in place (never reassigned) by `refreshSettingsCache()` once
 * the real save data is available. Add more fields here (with a matching default) as new consumers need them.
 */
export const cachedFormatSettings: Settings = {
  CurrencySymbol: '$',
  CurrencySymbolAfterValue: false,
  disableSuffixes: false,
  fractionalDigits: 3,
  hideThousandsSeparator: false,
  hideTrailingDecimalZeros: false,
  Locale: 'en-US',
  useEngineeringNotation: false,
  UseIEC60027_2: false,
}

const settingsChangeListeners: Array<() => void> = []

/** Registers a callback fired after `cachedFormatSettings` is updated by a successful `refreshSettingsCache()`. Returns an unsubscribe function. */
export function onSettingsChange(listener: () => void): () => void {
  settingsChangeListeners.push(listener)
  return () => {
    const i = settingsChangeListeners.indexOf(listener)
    if (i !== -1)
      settingsChangeListeners.splice(i, 1)
  }
}

/**
 * Re-reads settings from the save file in IndexedDB and merges them into `cachedFormatSettings` in place.
 * Safe to call repeatedly (e.g. from a long-running daemon/UI process that wants fresher data) — on failure it
 * silently leaves the previous cached values untouched rather than throwing.
 */
export async function refreshSettingsCache(): Promise<boolean> {
  try {
    const loaded = await reload()
    if (!loaded)
      return false
    Object.assign(cachedFormatSettings, loaded)
    for (const listener of settingsChangeListeners) listener()
    return true
  }
  catch {
    return false
  }
}

// Best-effort warm the cache as soon as this module is imported. Fire-and-forget: callers must not rely on
// cachedFormatSettings holding real data synchronously right after import, only eventually.
void refreshSettingsCache()
