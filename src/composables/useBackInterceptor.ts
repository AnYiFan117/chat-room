// 在原生(Capacitor)环境里,系统返回手势/返回键由 App.vue 统一监听。
// 某些页面(如聊天室)需要先拦截一次返回来做"收起输入法 / 二次确认退出"等处理,
// 因此提供一个共享的拦截器槽:页面在挂载时注册,卸载时清除。
// App.vue 在收到 backButton 时先调用拦截器:
//   返回 true  → 本次返回已被页面处理,不再执行默认的 router.back()
//   返回 false → 放行,执行默认返回逻辑

type BackInterceptor = () => boolean

let currentInterceptor: BackInterceptor | null = null

export const setBackInterceptor = (interceptor: BackInterceptor | null) => {
  currentInterceptor = interceptor
}

// 返回 true 表示已被拦截处理
export const runBackInterceptor = (): boolean => {
  if (!currentInterceptor) return false
  try {
    return currentInterceptor()
  } catch (error) {
    console.warn('back 拦截器执行失败', error)
    return false
  }
}
