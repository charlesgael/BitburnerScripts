# Get save in memory

```javascript
const request = indexedDB.open('bitburnerSave')

request.onsuccess = async (event) => {
  const db = event.target.result
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

      console.log('Raw JSON Text successfully extracted!')

      // Try parsing the inner JSON structure
      const gameObject = JSON.parse(rawText)
      window.gameMemory = gameObject

      console.log(
        '%c🎉 SUCCESS! Memory completely parsed.',
        'color: #00ff00; font-weight: bold;',
      )
      console.log(
        'Type \'window.gameMemory\' to inspect or modify your living save data.',
      )
    }
    catch (err) {
      console.error(
        'Decompression failed. Ensure the save isn\'t corrupted:',
        err,
      )
    }
  }
}
```
