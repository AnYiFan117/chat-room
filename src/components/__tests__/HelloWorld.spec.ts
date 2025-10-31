import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import HomeView from '../../views/HomeView.vue'

describe('HomeView hero section', () => {
  it('shows hero headline and actions', () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: ['RouterLink'],
      },
    })

    expect(wrapper.text()).toContain('欢迎来到我的前端小项目')
    expect(wrapper.text()).toContain('联系我')
  })
})
