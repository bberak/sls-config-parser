const co = require('co')
const YAML = require('yamljs')
const { file:fileHelp, obj:objHelp } = require('./utils')
const { join, dirname } = require('path')
const { homedir } = require('os')

const AWS_CREDS = join(homedir(), '.aws/credentials')

const _parseYmlToJson = (str, ymlPath) => {
	try {
		return YAML.parse(str)
	} catch(err) {
		throw new Error(`Failed to parse YAML file ${ymlPath}. ${err.stack || err.message}`)
	}
}

const _setRefDetails = (output, prop, raw) => {
	if (!output || !prop || !raw)
		return

	const [_path, alt] = raw.replace(`${prop}:`, '').split(',').map(p => p.trim())
	output.type = prop
	output[prop] = { path: _path.split('.'), dotPath:_path, alt: alt ? alt.replace(/(^'|^"|"$|'$)/g,'') : null } 
}

/**
 * 
 * @param  {String} ref 					e.g., 'self:provider.stage' or 'opt:stage', '${file(../config.json):CREDS}' or '${opt:stage, \'dev\'}'
 * 
 * @return {[String]} output.type			e.g., 'self', 'opt', 'env', ...
 * @return {[String]} output.self.path		e.g., ['provider', 'stage']
 * @return {[String]} output.self.dotPath	e.g., 'provider.stage'
 * @return {[String]} output.self.alt		e.g., null	
 * @return {[String]} output.opt.path		e.g., ['stage']
 * @return {[String]} output.opt.dotPath	e.g., 'provider.stage'
 * @return {[String]} output.opt.alt		e.g., 'dev'	
 * @return {[String]} output.file.path		e.g., ['../config.json', 'CREDS']
 * @return {[String]} output.file.dotPath	e.g., null
 * @return {[String]} output.file.alt		e.g., null	
 * @return {[String]} output.sls.path		e.g., ['instanceId']
 * @return {[String]} output.sls.dotPath	e.g., 'provider.stage'
 * @return {[String]} output.sls.alt		e.g., null	
 * @return {[String]} output.env.path		e.g., ['FUNC_PREFIX']
 * @return {[String]} output.env.dotPath	e.g., 'provider.stage'
 * @return {[String]} output.env.alt		e.g., null	
 * @return {[String]} output.cf.path		e.g., ['another-service-dev', 'functionPrefix']
 * @return {[String]} output.cf.dotPath		e.g., 'provider.stage'
 * @return {[String]} output.cf.alt			e.g., null	
 * @return {[String]} output.s3.path		e.g., ['myBucket/myKey']
 * @return {[String]} output.s3.dotPath		e.g., 'provider.stage'
 * @return {[String]} output.s3.alt			e.g., null	
 * @return {[String]} output.ssm.path		e.g., ['/path/to/service/id']
 * @return {[String]} output.ssm.dotPath	e.g., 'provider.stage'
 * @return {[String]} output.ssm.alt		e.g., null	
 */
const _getRefDetails = ref => {
	let output = {
		self:null,
		opt:null,
		file:null,
		sls:null,
		env:null,
		cf:null,
		s3:null,
		ssm:null
	}

	ref = ref ? ref.trim() : ''

	if (ref.indexOf('self') == 0)
		_setRefDetails(output, 'self', ref)
	else if (ref.indexOf('opt') == 0)
		_setRefDetails(output, 'opt', ref)
	else if (ref.indexOf('file') == 0) {
		const filePath = (ref.match(/^file\((.*?)\)/) || [])[1]
		if (filePath) {
			const vars = ref.replace(`file(${filePath})`,'').replace(':','').split('.')
			const _path = [filePath, ...vars]
			output.type = 'file'
			output.file = { path: _path, dotPath:vars.join('.'), alt:null } 
		}
	}
	else if (ref.indexOf('sls') == 0)
		_setRefDetails(output, 'sls', ref)
	else if (ref.indexOf('env') == 0)
		_setRefDetails(output, 'env', ref)
	else if (ref.indexOf('cf') == 0)
		_setRefDetails(output, 'cf', ref)
	else if (ref.indexOf('s3') == 0)
		_setRefDetails(output, 's3', ref)
	else if (ref.indexOf('ssm') == 0)
		_setRefDetails(output, 'ssm', ref)

	return output
}

const _getToken = str => {
	const [raw,value] = (str || '').match(/\$\{([^${]*?)\}/) || []
	if (!raw)
		return null 
	
	return {
		raw,
		value
	}
}

/**
 * [description]
 * @param  {String} name						e.g., 'stage'
 * @param  {String} value						e.g., 'special_${opt:stage, \'dev\'}'
 * @param  {String} ancestors					e.g., ['custom']
 *
 * @return {[String]} output.path				e.g., ['custom', 'stage']
 * @return {String}   output.dotPath			e.g., 'custom.stage'
 * @return {String}   output.raw				e.g., 'special_${opt:stage, \'dev\'}'
 * @return {String}   output.rel.raw			e.g., '${opt:stage, \'dev\'}'
 * @return {String}   output.rel.type			e.g., 'self', 'opt', 'env', ...
 * @return {[String]} output.ref.self.path		e.g., ['provider', 'stage']
 * @return {[String]} output.ref.self.dotPath	e.g., 'provider.stage'
 * @return {String}   output.ref.self.alt		e.g., null	
 * @return {[String]} output.ref.opt.path		e.g., ['stage']
 * @return {[String]} output.ref.opt.dotPath	e.g., 'stage'
 * @return {String}   output.ref.opt.alt		e.g., 'dev'	
 * @return {[String]} output.ref.file.path		e.g., ['../config.json', 'CREDS']
 * @return {[String]} output.ref.file.dotPath	e.g., null
 * @return {String}   output.ref.file.alt		e.g., null	
 * @return {[String]} output.ref.sls.path		e.g., ['instanceId']
 * @return {[String]} output.ref.sls.dotPath	e.g., 'instanceId'
 * @return {String}   output.ref.sls.alt		e.g., null	
 * @return {[String]} output.ref.env.path		e.g., ['FUNC_PREFIX']
 * @return {[String]} output.ref.env.dotPath	e.g., 'FUNC_PREFIX'
 * @return {String}   output.ref.env.alt		e.g., null	
 * @return {[String]} output.ref.cf.path		e.g., ['another-service-dev', 'functionPrefix']
 * @return {[String]} output.ref.cf.dotPath		e.g., 'another-service-dev.functionPrefix'
 * @return {String}   output.ref.cf.alt			e.g., null	
 * @return {[String]} output.ref.s3.path		e.g., ['myBucket/myKey']
 * @return {[String]} output.ref.s3.dotPath		e.g., 'myBucket/myKey'
 * @return {String}   output.ref.s3.alt			e.g., null	
 * @return {[String]} output.ref.ssm.path		e.g., ['/path/to/service/id']
 * @return {[String]} output.ref.ssm.dotPath	e.g., '/path/to/service/id'
 * @return {String}   output.ref.ssm.alt		e.g., null	
 */
const _getRefsFromString = ({ name, value, ancestors }) => {
	ancestors = ancestors || []
	if (!value || typeof(value) != 'string')
		return null

	const token = _getToken(value)
	if (!token)
		return null

	const { raw, value:ref } = token
	const _path = name ? [...ancestors, name] : ancestors
	return {
		path: _path,
		dotPath: _path.join('.'),
		raw: value,
		ref: {
			raw,
			..._getRefDetails(ref)
		}
	}
}

/**
 * [description]
 * @param  {Object}		config					e.g., 	{ 
 *                              							resources:
 *                              				   				Resources:
 *                              			        				UserTable:
 *                              			        					Properties:
 *                              			        						ProvisionedThroughput: '${self:custom.dynamodb.${self:provider.stage}ProvisionedThroughput}'
 *                              					 	}
 * @param  {[String]}	ancestors				e.g., []
 * 
 * @return {[String]} output[].path					e.g., ['custom', 'stage']
 * @return {String}   output[].dotPath				e.g., 'custom.stage'
 * @return {String}   output[].raw					e.g., 'special_${opt:stage, \'dev\'}'
 * @return {String}   output[].rel.raw				e.g., '${opt:stage, \'dev\'}'
 * @return {String}   output[].rel.type				e.g., 'self', 'opt', 'env', ...
 * @return {[String]} output[].ref.self.path		e.g., ['provider', 'stage']
 * @return {[String]} output[].ref.self.dotPath		e.g., 'provider.stage'
 * @return {String}   output[].ref.self.alt			e.g., null	
 * @return {[String]} output[].ref.opt.path			e.g., ['stage']
 * @return {[String]} output[].ref.opt.dotPath		e.g., 'stage'
 * @return {String}   output[].ref.opt.alt			e.g., 'dev'	
 * @return {[String]} output[].ref.file.path		e.g., ['../config.json', 'CREDS']
 * @return {[String]} output[].ref.file.dotPath		e.g., null
 * @return {String}   output[].ref.file.alt			e.g., null	
 * @return {[String]} output[].ref.sls.path			e.g., ['instanceId']
 * @return {[String]} output[].ref.sls.dotPath		e.g., 'instanceId'
 * @return {String}   output[].ref.sls.alt			e.g., null	
 * @return {[String]} output[].ref.env.path			e.g., ['FUNC_PREFIX']
 * @return {[String]} output[].ref.env.dotPath		e.g., 'FUNC_PREFIX'
 * @return {String}   output[].ref.env.alt			e.g., null	
 * @return {[String]} output[].ref.cf.path			e.g., ['another-service-dev', 'functionPrefix']
 * @return {[String]} output[].ref.cf.dotPath		e.g., 'another-service-dev.functionPrefix'
 * @return {String}   output[].ref.cf.alt			e.g., null	
 * @return {[String]} output[].ref.s3.path			e.g., ['myBucket/myKey']
 * @return {[String]} output[].ref.s3.dotPath		e.g., 'myBucket/myKey'
 * @return {String}   output[].ref.s3.alt			e.g., null	
 * @return {[String]} output[].ref.ssm.path			e.g., ['/path/to/service/id']
 * @return {[String]} output[].ref.ssm.dotPath		e.g., '/path/to/service/id'
 * @return {String}   output[].ref.ssm.alt			e.g., null	
 */
const _getExplicitTokenRefs = (config, ancestors) => {
	// Case 1: 'config' does not exist
	if (!config)
		return null
	
	ancestors = ancestors || []
	const isConfigObject = typeof(config) == 'object'
	const isConfigArray = Array.isArray(config)

	// Case 2: 'config' is a scalar
	if (!isConfigArray && !isConfigObject) {
		const ref = _getRefsFromString({ value:config, ancestors })
		return ref ? [ref] : null
	}

	// Case 3: 'config' is an array
	if (isConfigArray) {
		const [parentField='', ...rest] = ancestors.reverse()
		const firstAncestors = rest.reverse()
		return config.reduce((acc,subConfig,idx) => {
			const newAncestors = parentField ? [...firstAncestors, `${parentField}[${idx}]`] : [...firstAncestors]
			acc.push(...(_getExplicitTokenRefs(subConfig, newAncestors) || []))
			return acc
		}, [])
	}

	// Case 4: 'config' is an object
	const fields = Object.keys(config)
	if (!fields.length)
		return config 

	return fields.reduce((acc, field) => {
		const fieldValue = config[field]
		if (fieldValue) {
			const newAncestors = [...ancestors, field]
			acc.push(...(_getExplicitTokenRefs(fieldValue, newAncestors) || []))
		}
		return acc
	}, [])
}

const _replaceTokens = (config, rootFolder, options) => co(function *(){
	options = options || {}
	const explicitTokenRefs = _getExplicitTokenRefs(config) || []
	if (!explicitTokenRefs.length)
		return config
	else {
		const updatedConfig  = yield _injectTokens(config, explicitTokenRefs, rootFolder, options)
		return _replaceTokens(updatedConfig, rootFolder, options)
	}
}).catch(err => {
	throw new Error(err.stack)
})

/**
 * Determines whether an pbject's path is resolved or not
 * 
 * @param  {Object} obj 	e.g., { person: ${self:custom.person}, industry: { name: 'tech' } }
 * @param  {String} prop	e.g., 'person.name' or 'industry.name', or 'address.street'
 * @return {Boolean}		e.g., respectively false, true and null
 */
const _isPathResolved = (obj,prop) => {
	if (!prop)
		return obj 
	
	obj = obj || {}
	const props = prop.split('.')
	const { resp } = props.reduce((acc,p) => {
		if (acc.resp !== undefined)
			return acc 

		let val = acc.next[p]
		if (val === undefined)
			acc.resp = null 
		else if (typeof(val) == 'string' && _getToken(val))
			acc.resp = false
		else if (val === null)
			val = {}

		acc.next = val

		return acc
	},{ next:obj })

	return resp === undefined ? true : resp
}

const _resolveTokenRef = ({ config, tokenRef, tokenRefs, optTokens, rootFolder }) => co(function *() {
	const { raw='', ref, dotPath='' } = tokenRef	// e.g., p: [ 'resources', 'Resources', 'UserTable', 'Properties', 'TableName' ], raw: 'user_${opt:custom.stage}'
	const { type='', value } = ref || {}		// e.g., type: 'opt', value:'prod'
	const defaultValue = ref[type].alt		// e.g., 'dev'
	let resolvedValue = value 

	// 1. Resolve this token if its value is not set up yet.
	if (resolvedValue === undefined) {
		// Case 1.1: Resolve 'opt'
		if (type == 'opt') {
			// Get opt value from 'optTokens'
			const explicitValue = ref.opt.path && ref.opt.path[0] ? optTokens[ref.opt.path[0]] : null
			// Choose between the explicit value or the default one
			resolvedValue = explicitValue || defaultValue
			if (!resolvedValue)
				throw new Error(`'opt' ${ref.opt.path[0]} variable located under ${dotPath} not found. Please add a default value to cover this case.`)

		} 
		// Case 1.2: Resolve 'self'
		else if (type == 'self') {
			// If the 'self' path cannot be resolved because it depends on another token to be resolved first, than skip
			if (ref.self.dotPath && _isPathResolved(config, ref.self.dotPath) === false)
				return 
			// Get self value from 'config'
			const explicitValue = ref.self.dotPath ? objHelp.get(config, ref.self.dotPath) : null
			if (!explicitValue)
				throw new Error(`'self' variable ${ref.self.dotPath} located under ${dotPath} not found. Check if there are typos.`)

			// If the self's value is not a string, or is a string with no dynamic variable, then keep it
			if (typeof(explicitValue) != 'string' || !_getToken(explicitValue))
				resolvedValue = explicitValue
			else { // else try to find the self's in the 'tokenRefs' to resolve it.
				const selfTokenRef = tokenRefs.find(({ dotPath:dp }) => dp == ref.self.dotPath)
				if (selfTokenRef) 
					yield _resolveTokenRef({ config, tokenRef:selfTokenRef, tokenRefs, optTokens, rootFolder })
			}
		} else if (type == 'file') {
			const externalConfigPath = join(rootFolder, ref.file.path[0])
			const [, ...props] = ref.file.path
			const propsPath = props.join('.')
			const externalConfig = yield _parse(externalConfigPath, optTokens)
			if (!externalConfig)
				throw new Error(`'file' with path ${externalConfigPath} located under ${dotPath} is empty.`)

			resolvedValue = propsPath ? objHelp.get(externalConfig, propsPath) : externalConfig
		}
	}

	if (resolvedValue) {
		// 2. Mutate the original 'config' object
		const concreteValue = typeof(resolvedValue) != 'object' ? raw.replace(tokenRef.ref.raw, resolvedValue) : resolvedValue
		objHelp.set(config, dotPath, concreteValue)
		// 3. Mutate the 'tokenRef' value to save time for next iteration
		tokenRef.ref.value = resolvedValue
	}
}).catch(err => {
	throw new Error(err.stack)
})

const _injectTokens = (config, explicitTokenRefs, rootFolder, optTokens) => co(function *(){
	optTokens = optTokens || {}
	explicitTokenRefs = explicitTokenRefs || []
	optTokens = optTokens || {}

	yield explicitTokenRefs.map(tokenRef => _resolveTokenRef({
		config,
		tokenRef,
		tokenRefs: explicitTokenRefs,
		optTokens,
		rootFolder
	}))

	return config
}).catch(err => {
	throw new Error(err.stack)
})

const _parse = (ymlPath, options) => co(function *() {
	const fileExists = yield fileHelp.exists(ymlPath)
	if (!fileExists)
		throw new Error(`YAML file ${ymlPath} not found.`)

	const rootFolder = dirname(ymlPath)

	const ymlContent = yield fileHelp.read(ymlPath)
	if (!ymlContent || !ymlContent.length)
		throw new Error(`YAML file ${ymlPath} is empty.`)
	
	const config = _parseYmlToJson(ymlContent.toString(), ymlPath)

	return yield _replaceTokens(config, rootFolder, options)
}).catch(err => {
	throw new Error(err.stack)
})

/**
 *
 * 
 * @param {String}	options.profile		Default 'default'
 * @param {String}	options.awsCreds	Default '~/.aws/credentials'
 * 
 * @yield {String}	output.AWS_ACCESS_KEY_ID
 * @yield {String}	output.AWS_SECRET_ACCESS_KEY
 */
const _getAccessCreds = (options) => co(function *() {
	const { profile='default', awsCreds=AWS_CREDS } = options || {}
	const fileExists = yield fileHelp.exists(awsCreds)
	if (!fileExists)
		throw new Error(`${awsCreds} file not found. Create one and then fill it with your AWS access key and secret.`)

	const creds = yield fileHelp.read(awsCreds)

	if (!creds || !creds.length)
		throw new Error(`${awsCreds} file is empty. Create one and then fill it with your AWS access key and secret.`)

	const content = creds.toString().replace(/\r\n/g, '_linebreak_').replace(/\n/g, '_linebreak_')
	const reg = new RegExp(`\\[${profile}\\](.*?)aws_secret_access_key(\\s*)=(\\s*)(.*?)(\\s*)(_linebreak_|$)`)
	const [,access_key_str,,,access_secret] = content.match(reg) || []
	
	if (!access_key_str || !access_secret)
		return null

	const access_key = ((access_key_str.match(/aws_access_key_id(\s*)=(\s*)(.*?)_linebreak_/) || [])[3] || '').trim()

	return {
		AWS_ACCESS_KEY_ID: access_key,
		AWS_SECRET_ACCESS_KEY: access_secret.trim()
	}
})

/**
 * Gets all the environment variables defined in the config file (including the functions' specific variables).
 * 
 * @param {Object}		config
 * @param {[String]}	options.functions			If set, the array filters the functions that need to return env.
 * @param {Boolean}		options.ignoreGlobal		Default false. If true, global variables are ignored.
 * @param {Boolean}		options.ignoreFunctions		Default false. If true, the variables specific to functions are ignored.
 * @param {Boolean}		options.inclAccessCreds		Default false. If true, then, based on the 'config.provider.profile'.
 *                                            		(default is 'default'), retrieve the values found in the '~/.aws/credentials' file.
 * @param {String}		options.awsCreds			Default '~/.aws/credentials'
 * @yield {Object}		output
 */
const _getEnv = (config, options) => co(function *(){
	config = config || {}
	options = options || {}
	const { functions:functionNames, inclAccessCreds, ignoreFunctions, ignoreGlobal } = options
	const filterFunctions = (functionNames || []).length > 0
	const functions = config.functions || {}
	let globalEnv = (config.provider || {}).environment || {}
	
	if (ignoreFunctions)
		return globalEnv

	if (inclAccessCreds) {
		const profile = (config.provider || {}).profile
		const awsCreds = options.awsCreds
		const accessCreds = yield _getAccessCreds({ profile, awsCreds }) || {}
		globalEnv = { ...globalEnv, ...accessCreds }
	}

	return Object.keys(functions).reduce((acc,fname) => {
		if (functions[fname].environment && (!filterFunctions || filterFunctions.indexOf(fname) >= 0))
			acc = { ...acc, ...functions[fname].environment }
		return acc
	}, ignoreGlobal ? {} : globalEnv)
}).catch(err => {
	throw new Error(err.stack)
})

const Config = function (ymlPath, options) {
	let config

	this.config = () => co(function *(){
		if (!config)
			config = yield _parse(ymlPath, options)

		return config
	})

	/**
	 * Gets the environment variables from the 'ymlPath' config file.
	 * 
	 * @param {[String]}	options.functions			If set, the array filters the functions that need to return env.
	 * @param {Boolean}		options.format				Default 'standard'. Valid values:
	 *                                     					- 'standard': Output is formatted as follow: { VAL1: 'hello', VAL2: 'world' }
	 *                                     					- 'array': Output is formatted as follow: [{ name:'VAL1', value: 'hello' }, { name: 'VAL2', value: 'world' }]
	 * @param {Boolean}		options.ignoreGlobal		Default false. If true, global variables are ignored.
	 * @param {Boolean}		options.ignoreFunctions		Default false. If true, the variables specific to functions are ignored.
	 * @param {Boolean}		options.inclAccessCreds		Default false. If true, then, based on the 'config.provider.profile' 
	 *                                            		(default is 'default'), retrieve the values found in the '~/.aws/credentials' file.
	 * @param {String}		options.awsCreds			Default '~/.aws/credentials'
	 * 
	 * @yield {Object/Array}  output					Based on the 'options.format', 
	 *        												- 'standard': Output is formatted as follow: { VAL1: 'hello', VAL2: 'world' }
	 *                                     					- 'array': Output is formatted as follow: [{ name:'VAL1', value: 'hello' }, { name: 'VAL2', value: 'world' }]
	 */
	this.env = options => co(function *() {
		if (!config)
			config = yield _parse(ymlPath, options)
		
		const env = yield _getEnv(config, options) || {}
		if (options && options.format == 'array') {
			return Object.keys(env).map(key => ({ name: key, value: env[key] }))
		} else
			return env
	})

	return this
}

module.exports = {
	Config,
	_:{
		getExplicitTokenRefs: _getExplicitTokenRefs,
		getAccessCreds: _getAccessCreds
	}
}