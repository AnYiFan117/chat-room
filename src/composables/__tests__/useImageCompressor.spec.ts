import { describe, it, expect } from 'vitest'
import { compressImage, ImageTooLargeError } from '../useImageCompressor'

describe('useImageCompressor', () => {
  it('rejects non-image files', async () => {
    const file = new File(['hello'], 'doc.txt', { type: 'text/plain' })
    await expect(compressImage(file)).rejects.toThrow('请选择图片文件')
  })
})
