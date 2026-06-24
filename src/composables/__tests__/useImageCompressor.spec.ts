import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { compressImage, DEFAULT_MAX_IMAGE_SIZE, ImageTooLargeError } from '../useImageCompressor'

describe('useImageCompressor', () => {
  const originalImage = global.Image
  const originalGetContext = global.HTMLCanvasElement.prototype.getContext
  const originalToBlob = global.HTMLCanvasElement.prototype.toBlob
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalFileReader = global.FileReader

  let mockImageWidth = 100
  let mockImageHeight = 100
  let mockImageBehavior: 'load' | 'error' | 'abort' = 'load'
  let mockBlobSize = 20
  let mockFileReaderError = false
  let mockContext: { drawImage: ReturnType<typeof vi.fn> } | null = null

  beforeEach(() => {
    mockImageWidth = 100
    mockImageHeight = 100
    mockImageBehavior = 'load'
    mockBlobSize = 20
    mockFileReaderError = false
    mockContext = null

    global.Image = class MockImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      src = ''
      width = mockImageWidth
      height = mockImageHeight
      constructor() {
        setTimeout(() => {
          if (mockImageBehavior === 'error') {
            this.onerror?.()
          } else if (mockImageBehavior === 'abort') {
            this.onabort?.()
          } else {
            this.onload?.()
          }
        }, 0)
      }
    } as unknown as typeof Image

    mockContext = {
      drawImage: vi.fn(),
    }

    global.HTMLCanvasElement.prototype.getContext = vi.fn(
      () => mockContext,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext

    global.HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
      const blob = new Blob(['x'.repeat(mockBlobSize)], { type: 'image/jpeg' })
      callback(blob)
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob

    global.FileReader = class MockFileReader {
      onload: ((event: { target: { result: string } }) => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      result = ''
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      readAsDataURL(_: Blob) {
        if (mockFileReaderError) {
          setTimeout(() => this.onerror?.(), 0)
        } else {
          this.result = 'data:image/jpeg;base64,mock-base64-data'
          setTimeout(() => this.onload?.({ target: { result: this.result } }), 0)
        }
      }
    } as unknown as typeof FileReader

    URL.createObjectURL = vi.fn(() => 'blob:mock-url') as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    global.Image = originalImage
    global.HTMLCanvasElement.prototype.getContext = originalGetContext
    global.HTMLCanvasElement.prototype.toBlob = originalToBlob
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    global.FileReader = originalFileReader
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

  it('throws ImageTooLargeError when blob size exceeds maxSize', async () => {
    mockBlobSize = 2000
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file, { maxSize: 1000 })).rejects.toBeInstanceOf(ImageTooLargeError)
  })

  it('scales image dimensions when they exceed maxWidth and maxHeight', async () => {
    mockImageWidth = 2000
    mockImageHeight = 1000
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file, { maxWidth: 1200, maxHeight: 1200 })

    const context = mockContext
    expect(context!.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1200, 600)
  })

  it('throws ImageTooLargeError when default maxSize is exceeded', async () => {
    mockBlobSize = DEFAULT_MAX_IMAGE_SIZE + 1
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file)).rejects.toBeInstanceOf(ImageTooLargeError)
  })

  it('scales image dimensions with default 800x800 limits', async () => {
    mockImageWidth = 2000
    mockImageHeight = 1000
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await compressImage(file)

    const context = mockContext
    expect(context!.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 400)
  })

  it('rejects when image loading fails', async () => {
    mockImageBehavior = 'error'
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file)).rejects.toThrow('加载图片失败')
  })

  it('rejects when image loading is aborted', async () => {
    mockImageBehavior = 'abort'
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file)).rejects.toThrow('加载图片被中断')
  })

  it('rejects when FileReader encounters an error', async () => {
    mockFileReaderError = true
    const file = new File(['image'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(compressImage(file)).rejects.toThrow('读取图片失败')
  })
})
