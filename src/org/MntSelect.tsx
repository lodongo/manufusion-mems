import {useId,type ComponentProps} from 'react';
import {SelectField} from '../components/ui';
export default function MntSelect({id,...props}:Omit<ComponentProps<typeof SelectField>,'id'>&{id?:string}){const generated=useId();return <SelectField {...props} id={id||generated}/>;}
