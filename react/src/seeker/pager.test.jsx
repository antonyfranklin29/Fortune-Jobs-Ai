import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PAGE_SIZE, Pager } from './ResultsPage.jsx';
afterEach(cleanup);
it('shows numbered pages of 15 for long Pro result lists', () => {
  expect(PAGE_SIZE).toBe(15);
  const onPage = vi.fn();
  render(<Pager page={0} pages={Math.ceil(100 / PAGE_SIZE)} onPage={onPage} />);
  expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['‹', '1', '2', '3', '4', '5', '6', '7', '›']);
  expect(screen.getByRole('button', { name: 'Previous page' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(screen.getByRole('button', { name: '3' })); expect(onPage).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole('button', { name: 'Next page' })); expect(onPage).toHaveBeenCalledWith(1);
});
it('shows no pager for the 10 free results', () => {
  const { container } = render(<Pager page={0} pages={1} onPage={() => {}} />);
  expect(container.innerHTML).toBe('');
});
