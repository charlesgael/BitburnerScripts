import type { AnyMenuNode, DataMenuNode, MenuDividerOption, MenuGroupOption, MenuOption, MenuProps } from './types'
import React from '@react'
import { noop } from '../../../../utils/function/noop'
import { usePropState } from '../../../effects/use-prop-state'
import { classNames } from '../../../utils/classnames'

/* eslint-disable-next-line ts/no-empty-object-type */
function isSep<TData = {}>(el: AnyMenuNode<TData>): el is MenuDividerOption {
  return (el as any).type === 'divider'
}
/* eslint-disable-next-line ts/no-empty-object-type */
function isGroup<TData = {}>(el: AnyMenuNode<TData>): el is MenuGroupOption<TData> {
  return (el as any).type === 'group'
}
/* eslint-disable-next-line ts/no-empty-object-type */
function isOption<TData = {}>(el: AnyMenuNode<TData>): el is MenuOption<TData> {
  return !(el as any).type
}

/* eslint-disable-next-line ts/no-empty-object-type */
export function DataMenuNodeEl<TData = {}>(props: {
  option: DataMenuNode<TData>
  selected?: string | null
  click?: (key: string) => void
  level?: number
}) {
  const {
    option,
    selected,
    click = noop,
    level = 0,
  } = props

  return (
    <>
      <div
        key={option.key}
        className={
          classNames(
            'bb-list-item',
            {
              'bb-list-item--selected': selected === option.key,
              'bb-list-item--group': isGroup(option),
            },
          )
        }
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          textAlign: 'left',
          padding: '4px 6px',
          fontSize: 11,
          paddingLeft: 6 + 8 * level,
        }}
        onClick={() => isOption(option) ? click(option.key) : noop}
      >
        {option.icon && <span>{option.icon}</span>}
        <span className="bb-wrap" style={{ flex: 1 }}>
          {option.label}
        </span>
      </div>
      {option.children?.map(child => (
        <DataMenuNodeEl
          key={child.key}
          option={child}
          selected={selected}
          click={click}
          level={level + 1}
        />
      ))}
    </>
  )
}

/* eslint-disable-next-line ts/no-empty-object-type */
export function Menu<TData = {}>(menuProps: MenuProps<TData>) {
  const {
    options = [],
    value,
    onValueChange = noop,
  } = menuProps
  const [selected, setSelected] = usePropState(value || null)

  function find(key: string, options: AnyMenuNode<TData>[]): MenuOption<TData> | undefined {
    const dataNodes = options
      .filter((e): e is DataMenuNode<TData> => !isSep(e))

    for (const dataNode of dataNodes) {
      if (!isGroup(dataNode) && dataNode.key === key) {
        return dataNode as MenuOption<TData>
      }

      if (dataNode.children) {
        const found = find(key, dataNode.children)
        if (found)
          return found
      }
    }
    return undefined
  }

  function clicked(key: string) {
    const found = find(key, options)
    if (found) {
      setSelected(key)

      onValueChange(key, found)
    }
  }

  return (
    <div
      style={{
        userSelect: 'none',
      }}
    >
      {options.map(option => (
        isSep(option)
          ? <hr key={option.key} />
          : (
              <DataMenuNodeEl
                key={option.key}
                option={option as DataMenuNode<TData>}
                selected={selected}
                click={clicked}
              />
            )
      ))}
    </div>
  )
}
