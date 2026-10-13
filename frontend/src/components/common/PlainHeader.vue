<template>
  <!-- v2.11.0(#1181) 生产系统自己的公开页顶栏(文档 / 工程师邀请): 实例没有官网前台时用它, 不挂官网导航 -->
  <header class="plain-header">
    <div class="inner">
      <BrandMark :size="22" />
      <span class="name">{{ brand.name }}</span>
      <router-link to="/admin/login" class="enter">{{ $t('plainHeader.sign_in') }}</router-link>
    </div>
  </header>
</template>

<script setup>
import BrandMark from './BrandMark.vue'
import { getBrand } from '@/api/edition.js'

const brand = getBrand()
</script>

<style scoped>
.plain-header { border-bottom: 1px solid #eae7e2; background: #fff; }
.inner { max-width: 1200px; margin: 0 auto; padding: 14px 24px; display: flex; align-items: center; gap: 10px; }
.name { font-weight: 700; color: #1c1917; font-size: 16px; }
.enter { margin-left: auto; font-size: 14px; color: #d2521e; text-decoration: none; }
</style>
