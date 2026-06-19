<script setup lang="ts">
import { ref } from 'vue'

const name = ref('')
const email = ref('')
const message = ref('')

const handleSubmit = () => {
  // 在真实项目中这里会调用后端接口；目前仅做占位反馈
  window.alert(`感谢联系！我会尽快回复：${name.value || '友人'}`)
  name.value = ''
  email.value = ''
  message.value = ''
}
</script>

<template>
  <section class="contact">
    <header>
      <p class="eyebrow">Let's build something great</p>
      <h1>联系我</h1>
      <p class="lead">如果你对项目有建议、想要合作，或只是想打个招呼，填写下面的表格即可。</p>
    </header>

    <form class="contact-form" @submit.prevent="handleSubmit">
      <label>
        <span>姓名</span>
        <input v-model="name" name="name" type="text" placeholder="你怎么称呼？" required />
      </label>

      <label>
        <span>邮箱</span>
        <input v-model="email" name="email" type="email" placeholder="name@example.com" required />
      </label>

      <label class="message-field">
        <span>留言</span>
        <textarea
          v-model="message"
          name="message"
          rows="5"
          placeholder="写下你想聊的内容..."
          required
        />
      </label>

      <button type="submit">发送消息</button>
    </form>

    <aside class="contact-meta">
      <h2>其他渠道</h2>
      <ul>
        <li><strong>邮箱：</strong> hobby.dev@example.com</li>
        <li><strong>GitHub：</strong> github.com/my-hobby</li>
        <li><strong>微信：</strong> hobby-dev</li>
      </ul>
    </aside>
  </section>
</template>

<style scoped>
.contact {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 3rem;
  padding: clamp(3rem, 6vw, 5rem);
  background: #ffffff;
}

header {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  color: #0f172a;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.25em;
  font-size: 0.85rem;
  color: #047857;
  font-weight: 600;
}

h1 {
  font-size: clamp(2rem, 5vw, 2.75rem);
  margin: 0;
}

.lead {
  max-width: 50ch;
  color: #475569;
  line-height: 1.6;
}

.contact-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 1.75rem;
  border-radius: 18px;
  background: #f0fdf4;
  border: 1px solid rgba(74, 222, 128, 0.4);
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  font-weight: 600;
  color: #1f2937;
}

input,
textarea {
  padding: 0.85rem;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.5);
  background: #ffffff;
  font-size: 1rem;
  color: #0f172a;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease;
}

input:focus,
textarea:focus {
  outline: none;
  border-color: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
  background: #fff;
}

.message-field textarea {
  resize: vertical;
  min-height: 160px;
}

button {
  align-self: flex-start;
  padding: 0.9rem 1.8rem;
  border-radius: 999px;
  border: none;
  background: linear-gradient(135deg, #22c55e, #86efac);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(16, 185, 129, 0.3);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

button:hover {
  transform: translateY(-2px);
  box-shadow: 0 16px 28px rgba(16, 185, 129, 0.35);
}

.contact-meta {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.75rem;
  border-radius: 18px;
  border: 1px solid rgba(74, 222, 128, 0.35);
  background: #ecfdf5;
  color: #1f2937;
}

.contact-meta h2 {
  margin: 0;
  font-size: 1.25rem;
}

.contact-meta ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  font-size: 0.95rem;
  color: #475569;
}

@media (max-width: 960px) {
  .contact {
    grid-template-columns: 1fr;
  }

  .contact-meta {
    order: -1;
  }
}

@media (max-width: 640px) {
  .contact {
    padding: 2rem 1.5rem;
  }

  .contact-form {
    padding: 1.5rem;
  }

  .contact-meta {
    padding: 1.5rem;
  }
}

html.dark .contact {
  background: #0f172a;
}

html.dark header {
  color: #e2e8f0;
}

html.dark .eyebrow {
  color: #34d399;
}

html.dark .lead {
  color: #94a3b8;
}

html.dark .contact-form,
html.dark .contact-meta {
  background: rgba(30, 41, 59, 0.85);
  border-color: rgba(74, 222, 128, 0.2);
}

html.dark label {
  color: #e2e8f0;
}

html.dark input,
html.dark textarea {
  background: rgba(15, 23, 42, 0.7);
  border-color: rgba(148, 163, 184, 0.3);
  color: #e2e8f0;
}

html.dark input:focus,
html.dark textarea:focus {
  border-color: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
  background: rgba(15, 23, 42, 0.9);
}

html.dark .contact-meta h2 {
  color: #e2e8f0;
}

html.dark .contact-meta ul {
  color: #94a3b8;
}
</style>
