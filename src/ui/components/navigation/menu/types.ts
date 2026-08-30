import type React from '@react'

/* eslint-disable-next-line ts/no-empty-object-type */
export type MenuOption<TData = {}> = {
  children?: Array<DataMenuNode<TData>>
  key: string
  label: string | React.ReactElement
  show?: boolean
  disabled?: boolean
  icon?: string | React.ReactElement
} & TData
/* eslint-disable-next-line ts/no-empty-object-type */
export interface MenuGroupOption<TData = {}> {
  children?: Array<DataMenuNode<TData>>
  key: string
  label: string | React.ReactElement
  show?: boolean
  icon?: string | React.ReactElement
  type: 'group'
}
export interface MenuDividerOption {
  key: string
  type: 'divider'
}

/* eslint-disable-next-line ts/no-empty-object-type */
export type DataMenuNode<TData = {}> = MenuOption<TData> | MenuGroupOption<TData>
/* eslint-disable-next-line ts/no-empty-object-type */
export type AnyMenuNode<TData = {}> = DataMenuNode<TData> | MenuDividerOption

/* eslint-disable-next-line ts/no-empty-object-type */
export interface MenuProps<TData = {}> {
  options: Array<AnyMenuNode<TData>>
  value?: string | null
  onValueChange?: (key: string, item: MenuOption<TData>) => void
}
