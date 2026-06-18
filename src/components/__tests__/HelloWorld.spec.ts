import { describe, it, expect, beforeEach } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import HomeView from '../../views/HomeView.vue'

describe('HomeView hero section', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows hero headline and actions', () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: ['RouterLink'],
      },
    })

    expect(wrapper.text()).toContain('欢迎来到 Blow 在线聊天室')
    expect(wrapper.text()).toContain('创建房间')
    expect(wrapper.text()).toContain('加入房间')
  })
})
