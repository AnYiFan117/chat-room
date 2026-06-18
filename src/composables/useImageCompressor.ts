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

/**
 * 压缩图片并返回 base64 Data URL。
 *
 * 输出格式固定为 image/jpeg，以控制大小；透明背景会被转换为白色。
 */
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
            if (blob.size > maxSize) {
              reject(new ImageTooLargeError())
              return
            }
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = () => reject(new Error('读取图片失败'))
            reader.onabort = () => reject(new Error('读取图片被中断'))
            reader.readAsDataURL(blob)
          },
          'image/jpeg',
          quality
        )
      }
      image.onerror = () => reject(new Error('加载图片失败'))
      image.onabort = () => reject(new Error('加载图片被中断'))
      image.src = objectUrl
    })

    return dataUrl
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
