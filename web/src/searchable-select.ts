export interface ChoiceOption { readonly value: string; readonly label: string }

export function matchingOptions(options: readonly ChoiceOption[], query: string): ChoiceOption[] {
  const needle=query.trim().toLocaleLowerCase()
  return needle?options.filter(option=>option.label.toLocaleLowerCase().includes(needle)):[...options]
}

/** Typing filters the list; Enter or a click commits; Escape or leaving the field restores the current choice. */
export class SearchableSelect {
  private options: readonly ChoiceOption[] = []
  private shown: ChoiceOption[] = []
  private value = ''
  private query = ''
  private active = -1

  constructor(
    private readonly input: HTMLInputElement,
    private readonly list: HTMLUListElement,
    private readonly choose: (value: string) => void,
  ) {
    input.addEventListener('focus', () => this.open())
    input.addEventListener('click', () => { if (list.hidden) this.open() })
    input.addEventListener('input', () => this.filter(input.value))
    input.addEventListener('keydown', event => this.navigate(event))
    input.addEventListener('blur', () => this.close())
    list.addEventListener('mousedown', event => {
      event.preventDefault()
      const item=(event.target as Element).closest<HTMLElement>('[role="option"]')
      if (item) this.commit(this.shown[Number(item.dataset.index)])
    })
  }

  update(options: readonly ChoiceOption[], value: string, disabled: boolean): void {
    this.options=options
    this.value=value
    this.input.disabled=disabled
    if (disabled || this.list.hidden) this.close()
    else this.filter(this.query)
  }

  private open(): void {
    if (this.input.disabled) return
    this.input.select()
    this.filter('')
  }

  private filter(query: string): void {
    this.query=query
    this.shown=matchingOptions(this.options,query)
    const current=this.shown.findIndex(option=>option.value===this.value)
    this.active=!query && current>=0 ? current : this.shown.length ? 0 : -1
    const items=this.shown.map((option,index)=>{
      const item=document.createElement('li')
      item.id=`${this.list.id}-${index}`
      item.dataset.index=String(index)
      item.setAttribute('role','option')
      item.setAttribute('aria-selected',String(option.value===this.value))
      item.textContent=option.label
      return item
    })
    if (!items.length) {
      const empty=document.createElement('li')
      empty.className='searchable-select-empty'
      empty.textContent='No match'
      items.push(empty)
    }
    this.list.replaceChildren(...items)
    this.list.hidden=false
    this.input.setAttribute('aria-expanded','true')
    this.highlight()
  }

  private highlight(): void {
    this.list.querySelector('.active')?.classList.remove('active')
    const item=this.active>=0 ? this.list.children[this.active] as HTMLElement : null
    if (!item) {
      this.input.removeAttribute('aria-activedescendant')
      return
    }
    item.classList.add('active')
    this.input.setAttribute('aria-activedescendant',item.id)
    item.scrollIntoView({block:'nearest'})
  }

  private navigate(event: KeyboardEvent): void {
    if (event.key==='ArrowDown' || event.key==='ArrowUp') {
      event.preventDefault()
      if (this.list.hidden) this.open()
      else if (this.shown.length) {
        this.active=Math.max(0,Math.min(this.shown.length-1,this.active+(event.key==='ArrowDown'?1:-1)))
        this.highlight()
      }
    } else if (event.key==='Enter' && !this.list.hidden) {
      event.preventDefault()
      this.commit(this.shown[this.active])
    } else if (event.key==='Escape' && !this.list.hidden) {
      event.preventDefault()
      this.close()
    }
  }

  private commit(option: ChoiceOption | undefined): void {
    if (!option) return
    const changed=option.value!==this.value
    this.value=option.value
    this.close()
    if (changed) this.choose(option.value)
  }

  private close(): void {
    this.query=''
    this.list.hidden=true
    this.list.replaceChildren()
    this.input.setAttribute('aria-expanded','false')
    this.input.removeAttribute('aria-activedescendant')
    this.input.value=this.options.find(option=>option.value===this.value)?.label??''
  }
}
