// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

describe('App', () => {
  it('renders the scaffold status accessibly', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '캘공' })).toBeInTheDocument()
    expect(screen.getByText('프로젝트 골격')).toBeInTheDocument()
    expect(screen.getByText('SQLite 데이터 모델')).toBeInTheDocument()
  })
})
