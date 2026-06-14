import * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Check } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { cn } from '@/lib/utils';
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export interface AutocompleteOption {
  value: string;
  label: string;
}

interface AutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  options?: AutocompleteOption[];
  onSearch?: (query: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  debounceMs?: number;
}

export default function Autocomplete({
  value,
  onChange,
  options = [],
  onSearch,
  placeholder = 'Search...',
  emptyMessage = 'No results found.',
  disabled = false,
  className,
  debounceMs = 300,
}: AutocompleteProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value);

  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  const debouncedSearch = useDebouncedCallback((query: string) => {
    onSearch?.(query);
  }, debounceMs);

  const handleInputChange = (val: string) => {
    setInputValue(val);
    setOpen(true);
    debouncedSearch(val);
  };

  const handleSelect = (selectedValue: string) => {
    const option = options.find((o) => o.value === selectedValue);
    if (option) {
      setInputValue(option.label);
      onChange(option.value);
    }
    setOpen(false);
  };

  return (
    <CommandPrimitive className={cn('relative', className)} shouldFilter={!onSearch}>
      <div className="relative">
        <CommandPrimitive.Input
          ref={inputRef}
          value={inputValue}
          onValueChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-3 py-2 border border-neutral-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 disabled:opacity-50"
        />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-white shadow-lg">
          <CommandList>
            <CommandEmpty className="py-3 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={handleSelect}
                  className="cursor-pointer"
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === option.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </div>
      )}
    </CommandPrimitive>
  );
}
