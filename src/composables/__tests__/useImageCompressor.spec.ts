import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage, ImageTooLargeError } from '../useImageCompressor'

describe('useImageCompressor', () => {
  const originalImage = global.Image
  const originalGetContext = global.HTMLCanvasElement.prototype.getContext
  const originalToBlob = global.HTMLCanvasElement.prototype.toBlob
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    global.Image = class MockImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      src = ''
      width = 100
      height = 100
      constructor() {
        setTimeout(() => this.onload?.(), 0)
      }
    } as unknown as typeof Image

    global.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext

    global.HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      const blob = new Blob(['compressed-image-bytes'], { type: 'image/jpeg' })
      callback(blob)
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob

    URL.createObjectURL = vi.fn(() => 'blob:mock-url') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    global.Image = originalImage
    global.HTMLCanvasElement.prototype.getContext = originalGetContext
    global.HTMLCanvasElement.prototype.toBlob = originalToBlob
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  it('rejects non-image files', async () => {
    const file = new File(['hello'], 'doc.txt', { type: 'text/plain' })
    await expect(compressImage(file)).rejects.toThrow('请选择图片文件')
  })

  it('returns a jpeg data URL for valid images', async () => {
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await compressImage(file)
    expect(result).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('throws ImageTooLargeError when maxSize is exceeded', async () => {
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file, { maxSize: 1 })).rejects.toBeInstanceOf(ImageTooLargeError)
  })
})
