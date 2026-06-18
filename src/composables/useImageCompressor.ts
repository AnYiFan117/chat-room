export class ImageTooLargeError extends Error {
  constructor(message = '图片压缩后仍超过大小限制') {
    super(message)
    this.name = 'ImageTooLargeError'
  }
}

export interface CompressImageOptions {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  maxSize?: number
}

export async function compressImage(
  file: File,
  options: CompressImageOptions = {}
): Promise<string> {
  const {
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 0.8,
    maxSize = 2 * 1024 * 1024,
  } = options

  if (!file.type.startsWith('image/')) {
    throw new TypeError('请选择图片文件')
  }

  const objectUrl = URL.createObjectURL(file)

  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        let { width, height } = image
        if (width > maxWidth || height > maxHeight) {
          const scale = Math.min(maxWidth / width, maxHeight / height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('无法创建 canvas 上下文'))
          return
        }
        context.drawImage(image, 0, 0, width, height)

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('图片压缩失败'))
              return
            }
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('读取图片失败'))
            reader.readAsDataURL(blob)
          },
          'image/jpeg',
          quality
        )
      }
      image.onerror = () => reject(new Error('加载图片失败'))
      image.src = objectUrl
    })

    const base64 = dataUrl.split(',')[1] ?? ''
    const estimatedSize = Math.round((base64.length * 3) / 4)
    if (estimatedSize > maxSize) {
      throw new ImageTooLargeError()
    }

    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
